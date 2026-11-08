from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    page = b.new_page(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script('''window.serialWrites=0;window.openCount=0;window.selectCount=0;window.failPicker=false;window.port=null;const bus=new EventTarget();const serialAPI={addEventListener:bus.addEventListener.bind(bus),async requestPort(){window.selectCount++;if(window.failPicker)throw new DOMException('No port selected by user','NotFoundError');const port=new EventTarget();port.open=async()=>{window.openCount++;port.readable=new ReadableStream();port.writable=new WritableStream({write(){window.serialWrites++}})};port.close=async()=>{};port.getInfo=()=>({usbVendorId:0x10c4,usbProductId:0xea60});port.setSignals=async()=>{};window.port=port;return port;}};window.simulateDisconnect=()=>{const e=new Event('disconnect');Object.defineProperty(e,'target',{value:window.port});bus.dispatchEvent(e)};Object.defineProperty(navigator,'serial',{value:serialAPI});''')
    page.goto('http://localhost:4200/')
    page.get_by_role('button', name='Открыть расширенный режим', exact=True).click()
    recovery = page.get_by_role('region', name='Диагностика и восстановление')
    expect(recovery).to_be_visible()
    page.get_by_role('button', name='Выбрать USB-порт', exact=True).click()
    expect(page.get_by_role('button', name='Отключить', exact=True)).to_be_visible()
    header = bytearray(64)
    header[0], header[1], header[12] = 0xe9, 3, 5
    page.get_by_label('Файл прошивки .bin', exact=True).set_input_files({'name': 'C3-wrong-for-S3.bin', 'mimeType': 'application/octet-stream', 'buffer': bytes(header)})
    page.get_by_label('Подтверждение формата локального образа', exact=True).check()
    page.get_by_role('button', name='Стереть и прошить', exact=True).click()
    page.get_by_role('button', name='Да, прошить', exact=True).click()
    expect(recovery.get_by_text('IMAGE_OR_FAMILY', exact=True)).to_be_visible()
    assert page.evaluate('window.serialWrites') == 0
    page.get_by_label('Микроконтроллер', exact=True).select_option('esp32c6')
    with page.expect_download() as download:
        page.get_by_role('button', name='Скачать журнал диагностики', exact=True).click()
    download.value.save_as('/tmp/recovery-session.txt')
    report = open('/tmp/recovery-session.txt').read()
    assert 'Target: ESP32-S3' in report and 'C3-wrong-for-S3.bin' in report
    assert 'Flash may have changed: false' in report and 'ERROR:' in report
    print('PASS frozen error journal after target change, no writes')
    page.get_by_role('button', name='Выбрать USB-порт заново', exact=True).click()
    expect(page.get_by_role('button', name='Отключить', exact=True)).to_be_visible()
    assert page.evaluate('window.serialWrites') == 0
    page.evaluate('window.simulateDisconnect()')
    expect(page.get_by_role('button', name='Подключить', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Определить чип', exact=True)).to_be_disabled()
    page.evaluate('window.failPicker=true')
    page.get_by_role('button', name='Выбрать USB-порт', exact=True).click()
    expect(recovery.get_by_text('PORT_NOT_SELECTED', exact=True)).to_be_visible()
    assert page.evaluate('window.serialWrites') == 0
    assert not errors, errors
    page.screenshot(path='/tmp/recovery-desktop.png')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_role('button', name='Скачать журнал диагностики', exact=True).scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/recovery-mobile.png')
    print('PASS reconnect zero writes, USB disconnect status, cancelled picker diagnosis, mobile overflow, no runtime errors')
    b.close()