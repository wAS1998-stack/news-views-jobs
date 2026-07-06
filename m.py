import http.server,socketserver,threading,os
from playwright.sync_api import sync_playwright
os.chdir("dist")
httpd=socketserver.TCPServer(("",8093),http.server.SimpleHTTPRequestHandler); httpd.allow_reuse_address=True
threading.Thread(target=httpd.serve_forever,daemon=True).start()
ok=True
with sync_playwright() as p:
    b=p.chromium.launch(); m=b.new_page(viewport={"width":390,"height":844})
    for path in ["/","/updates/","/qualification/engineering-diploma/","/jobs/rrb-alp-2026/"]:
        m.goto("http://localhost:8093"+path,wait_until="networkidle")
        if m.evaluate("document.documentElement.scrollWidth")>395: ok=False; print("overflow",path)
    # mobile dropdown
    m.goto("http://localhost:8093/"); m.click(".nav-dd summary"); m.wait_for_timeout(200)
    r=m.evaluate("document.querySelector('.nav-dd .dd').getBoundingClientRect().right")
    print("mobile: no overflow:", ok, "| dropdown fits:", r<=390)
    b.close()
