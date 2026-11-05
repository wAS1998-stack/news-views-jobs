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
 * that removes ads for good and keeps the preparation tips open. Dormant until appAds.pro is true in the feed and the
 * product exists in Play Console; without Play (or before the product exists) the price stays blank and nothing is
 * shown. Purchases are restored from Play on every start, so nothing is stored but a cached flag.
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
            .build()
        client = c
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) { Log.i(TAG, "setup: ${result.debugMessage}"); return }
                c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { r, list ->
                    if (r.responseCode == BillingClient.BillingResponseCode.OK) handle(list, authoritative = true)
                }
                val q = QueryProductDetailsParams.newBuilder().setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.INAPP).build(),
                )).build()
                c.queryProductDetailsAsync(q) { r, list ->
                    details = list.firstOrNull()
                    _price.value = details?.oneTimePurchaseOfferDetails?.formattedPrice ?: ""
                    Log.i(TAG, "product: ${r.responseCode} price='${_price.value}'")
                }
            }
            override fun onBillingServiceDisconnected() { Log.i(TAG, "disconnected") }
        })
    }

    /** [authoritative]: the full list from Play (a refund or missing purchase switches Pro off again). */
    private fun handle(purchases: List<Purchase>, authoritative: Boolean) {
        val c = client ?: return
        var owned = false
        for (p in purchases) {
            if (product !in p.products || p.purchaseState != Purchase.PurchaseState.PURCHASED) continue
            owned = true
            if (!p.isAcknowledged) c.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { }
        }
        if (owned) { setPro(true); if (!authoritative) app?.let { Stats.event(it, "pro_purchased") } }
        else if (authoritative) setPro(false)
    }

    private fun setPro(v: Boolean) {
        app?.getSharedPreferences(Ads.PREFS, Context.MODE_PRIVATE)?.edit()?.putBoolean("pro", v)?.apply()
        Ads.setPro(v)
    }

    /** Opens Play's purchase sheet. False when Play or the product isn't available. */
    fun buy(activity: Activity): Boolean {
        val c = client ?: return false
        val d = details ?: return false
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build(),
        )).build()
        Stats.event(activity, "pro_open")
        return c.launchBillingFlow(activity, params).responseCode == BillingClient.BillingResponseCode.OK
    }
}
