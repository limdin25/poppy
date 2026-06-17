"""Verify: main inbox shows OpenRent badge, badge deep-links to the OpenRent chat,
OpenRent inbox shows active actions + Send agreement."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_context(viewport={"width": 1340, "height": 920}).new_page()
    page.set_default_timeout(45000)
    page.goto("https://hostunico.com/login", wait_until="domcontentloaded"); page.wait_for_timeout(2500)
    page.click("text=WhatsApp user"); page.wait_for_timeout(6000)

    # 1) main inbox — Victoria graduated in (has a number) with an OpenRent badge
    page.goto("https://hostunico.com/app/inbox", wait_until="domcontentloaded"); page.wait_for_timeout(5000)
    page.screenshot(path="data/v_main_inbox.png", full_page=False)
    body = page.inner_text("body")
    print("Victoria in main inbox:", "Victoria" in body)
    print("OpenRent badge present:", page.locator("[title='From OpenRent — open the OpenRent chat']").count())

    # 2) click the OpenRent badge → should deep-link to /app/openrent/<id>
    try:
        page.locator("[title='From OpenRent — open the OpenRent chat']").first.click()
        page.wait_for_timeout(4000)
        print("after badge click url:", page.url)
        page.screenshot(path="data/v_openrent_deeplink.png", full_page=False)
    except Exception as e:
        print("badge click:", e)

    # 3) OpenRent inbox — open Victoria, see active actions + Send agreement
    page.goto("https://hostunico.com/app/openrent", wait_until="domcontentloaded"); page.wait_for_timeout(5000)
    try:
        page.click("text=Victoria"); page.wait_for_timeout(3000)
    except Exception as e:
        print("select victoria:", e)
    page.screenshot(path="data/v_openrent_inbox.png", full_page=False)
    print("Send agreement present:", "Send agreement" in page.inner_text("body"))
    b.close()
