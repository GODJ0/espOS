"""UI-only oRPC mocks; cryptographic bridge covered by Bun/Python tests."""
import json
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome')
    page = browser.new_page(viewport={'width':390,'height':844})
    errors, calls = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    fail = [False]
    def config(route):
        route.fulfill(json={'json':{'enabled':True,'device':'192.168.1.80','protocol':'espos-lan-v2'}})
    def command(route):
        cmd = route.request.post_data_json['json']['command']
        calls.append(cmd)
        if fail[0]:
            route.fulfill(status=400,json={'json':{'defined':False,'code':'BAD_REQUEST','status':400,'message':'Подпись ответа не совпадает'}})
            return
        result = {
            'status':{'protocol':'espos-lan-v2','device':{'name':'mock-S3'}},
            'list':{'path':'/apps/hello','entries':[{'path':'/apps/hello/app.py','name':'app.py','directory':False,'size':8}]},
            'read':{'path':'/apps/hello/app.py','revision':'a'*64,'content':'# hello\n'},
            'write':{'path':'/apps/hello/app.py','revision':'b'*64,'bytes':10},
            'reboot':{'accepted':True},
        }[cmd['op']]
        route.fulfill(json={'json':result})
    page.route('**/api/rpc/lan/config', config)
    page.route('**/api/rpc/lan/command', command)
    page.goto('http://localhost:4200/')
    page.get_by_role('button',name='Открыть расширенный режим',exact=True).click()
    page.get_by_role('button',name='Wi-Fi',exact=True).click()
    token = page.get_by_label('Токен Wi-Fi',exact=True)
    token.fill('a1'*32)
    listing = page.get_by_role('button',name='Обновить список',exact=True)
    reboot = page.get_by_role('button',name='Перезапустить плату по Wi-Fi',exact=True)
    pairing = page.get_by_role('button',name='Проверить сопряжение / статус',exact=True)
    expect(listing).to_be_disabled();expect(reboot).to_be_disabled()
    pairing.click();expect(listing).to_be_enabled()
    listing.click()
    page.get_by_role('button',name='app.py',exact=False).click()
    editor = page.get_by_label('Wi-Fi редактор файла',exact=True)
    editor.fill('# updated\n')
    page.get_by_role('button',name='Сохранить файл по Wi-Fi',exact=True).click()
    assert not any(c['op']=='write' for c in calls)
    page.get_by_role('button',name='Подтвердить действие',exact=True).click()
    expect(page.get_by_text('Файл обновлён.',exact=False)).to_be_visible()
    assert sum(c['op']=='write' for c in calls)==1
    assert calls[-1]['confirm'] is True
    token.fill('b2'*32);expect(listing).to_be_disabled();expect(editor).to_have_count(0)
    expect(page.get_by_text('Файл обновлён.',exact=False)).to_have_count(0)
    pairing.click();expect(listing).to_be_enabled()
    page.get_by_role('button',name='Забыть сессию',exact=True).click()
    expect(token).to_have_value('');expect(listing).to_be_disabled()
    token.fill('a1'*32);pairing.click();expect(listing).to_be_enabled()
    fail[0]=True
    before=len(calls);listing.click();expect(listing).to_be_disabled()
    expect(page.get_by_text('Подпись ответа не совпадает',exact=False)).to_be_visible()
    assert len(calls)==before+1
    fail[0]=False
    pairing.click();expect(reboot).to_be_enabled();reboot.click()
    page.get_by_role('button',name='Подтвердить действие',exact=True).click()
    expect(listing).to_be_disabled()
    page.get_by_text('Настройка платы через USB',exact=True).click()
    expect(page.get_by_role('button',name='Отозвать LAN-доступ по USB',exact=True)).to_be_disabled()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('localStorage.length')==0
    assert not errors, errors
    page.screenshot(path='/tmp/wifi-v2-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/wifi-v2-desktop.png',full_page=True)
    print('PASS v2 pairing gate, explicit write, token/forget/error/reboot evidence reset, no retry, mobile/desktop overflow, no runtime errors')
    browser.close()