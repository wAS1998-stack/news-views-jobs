package com.newsviews.app.play

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.newsviews.app.Stats
import com.newsviews.app.ads.Ads
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * "Sarkari Radar Pro": one one-time purchase through Google Play Billing (product id from the feed, appAds.proProduct)
 * that removes ads for good and keeps the preparation tips open. The Buy button shows only while appAds.pro is true in the
 * feed and Play answers with a price; purchases are restored from Play on every start and every return to the app
 * WHATEVER that switch says (someone who paid keeps Pro even if sales are paused), so nothing is stored but a cached flag.
 */
object Billing {
    private const val TAG = "NVBilling"
    private var app: Context? = null
    private var client: BillingClient? = null
    private var product = ""
    private var details: ProductDetails? = null
    private val _price = MutableStateFlow("")
    /** The localised price ("₹149") once Play has answered; blank = not available. */
    val price: StateFlow<String> = _price.asStateFlow()

    fun start(ctx: Context, productId: String) {
        app = ctx.applicationContext
        if (productId.isBlank() || (client != null && product == productId)) return
        product = productId
        client?.endConnection()
        val c = BillingClient.newBuilder(ctx.applicationContext)
            .setListener { result, purchases ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) handle(purchases, authoritative = false)
                else Log.i(TAG, "purchase: ${result.responseCode} ${result.debugMessage}")
            }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()        // Billing 8: reconnects by itself after Play drops the connection
            .build()
        client = c
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.i(TAG, "setup: ${result.debugMessage}")
                    // no Play Store / Play too old is normal on some phones; anything else is worth a look
                    if (result.responseCode != BillingClient.BillingResponseCode.BILLING_UNAVAILABLE)
                        Stats.nonFatal(IllegalStateException("billing setup ${result.responseCode}: ${result.debugMessage}"), "billing_setup")
                    return
                }
                recheck()
                val q = QueryProductDetailsParams.newBuilder().setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.INAPP).build(),
                )).build()
                c.queryProductDetailsAsync(q) { r, res ->
                    details = res.productDetailsList.firstOrNull()
                    _price.value = details?.oneTimePurchaseOfferDetails?.formattedPrice ?: ""
                    Log.i(TAG, "product: ${r.responseCode} price='${_price.value}'")
                }
            }
            override fun onBillingServiceDisconnected() { Log.i(TAG, "disconnected") }
        })
    }

    /** Asks Play again which purchases this account owns (on start and whenever the app comes back): restores Pro after
        a reinstall or a new phone, switches it off after a refund, and acknowledges anything not yet acknowledged. */
    fun recheck() {
        val c = client ?: return
        if (!c.isReady) return
        c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { r, list ->
            if (r.responseCode == BillingClient.BillingResponseCode.OK) handle(list, authoritative = true)
        }
    }

    /** [authoritative]: the full list from Play (a refund or missing purchase switches Pro off again). */
    private fun handle(purchases: List<Purchase>, authoritative: Boolean) {
        val c = client ?: return
        var owned = false
        for (p in purchases) {
            if (product !in p.products || p.purchaseState != Purchase.PurchaseState.PURCHASED) continue
            owned = true
            // unacknowledged purchases are refunded by Play after 3 days; a failed attempt is retried on the next recheck()
            if (!p.isAcknowledged) c.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { r ->
                if (r.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "acknowledge: ${r.responseCode} ${r.debugMessage}")
                    Stats.nonFatal(IllegalStateException("billing acknowledge ${r.responseCode}: ${r.debugMessage}"), "billing_ack")
                }
            }
        }
        if (owned) {
            setPro(true)
            if (!authoritative) app?.let { ctx ->
                val o = details?.oneTimePurchaseOfferDetails
                Stats.purchase(ctx, product, (o?.priceAmountMicros ?: 0L) / 1_000_000.0, o?.priceCurrencyCode ?: "INR")
            }
        }
        else if (authoritative) setPro(false)
    }

    private fun setPro(v: Boolean) {
        app?.getSharedPreferences(Ads.PREFS, Context.MODE_PRIVATE)?.edit()?.putBoolean("pro", v)?.apply()
        Ads.setPro(v)
    }

    /** Opens Play's purchase sheet. False when Play or the product isn't available. */
    fun buy(activity: Activity, from: String = "other"): Boolean {
        val c = client ?: return false
        val d = details ?: return false
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build(),
        )).build()
        Stats.event(activity, "pro_open", "from" to from)
        return c.launchBillingFlow(activity, params).responseCode == BillingClient.BillingResponseCode.OK
    }
}
