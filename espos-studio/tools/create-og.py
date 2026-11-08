"""Render the branded social card; schematic decoration, not a physical board."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
im = Image.new('RGB', (1200, 630), '#08090B')
d = ImageDraw.Draw(im)
cyan = '#22D3EE'
white = '#E7EAEF'
muted = '#8A93A2'
def font(size, bold=False):
    path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    return ImageFont.truetype(path, size)
def mono(size):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', size)
for x in range(0, 1200, 40):
    d.line((x,0,x,630), fill='#101419')
for y in range(0, 630, 40):
    d.line((0,y,1200,y), fill='#101419')
d.rectangle((0,0,1199,7),fill=cyan)
d.text((66,60), 'MICROPYTHON / ESP32 / USB',font=mono(19),fill=cyan)
d.text((60,139),'esp',font=font(96,True),fill=white)
end = 60 + d.textlength('esp',font=font(96,True))
d.text((end,139),'OS',font=font(96,True),fill=cyan)
d.text((65,258),'STUDIO',font=mono(48),fill=white)
d.line((66,344,623,344),fill='#283039',width=2)
d.text((66,374),'От первого подключения',font=font(30),fill=white)
d.text((66,420),'до своих приложений.',font=font(30),fill=white)
d.text((66,552),'ПРОСТОЙ СТАРТ  /  ПОЛНЫЙ КОНТРОЛЬ',font=mono(18),fill=muted)
# A stylised IC and traces; deliberately not a real board photograph or wiring diagram.
cx,cy = 924,302
for i in range(8):
    offset=-91+i*26
    for side in (-1,1):
        x=cx+side*130
        d.line((x,cy+offset,x+side*35,cy+offset),fill=cyan,width=4)
        y=cy+side*130
        d.line((cx+offset,y,cx+offset,y+side*35),fill=cyan,width=4)
for start,points in [(0,[(759,237),(715,237),(715,123),(1070,123)]),(1,[(1089,367),(1128,367),(1128,487),(813,487)]),(2,[(898,467),(898,529),(1045,529)])]:
    d.line(points,fill='#216171',width=2)
    x,y=points[-1];d.ellipse((x-5,y-5,x+5,y+5),fill=cyan)
d.rectangle((cx-130,cy-130,cx+130,cy+130),fill='#0E171D',outline=cyan,width=3)
d.rectangle((cx-105,cy-105,cx+105,cy+105),outline='#245565',width=1)
d.text((cx-75,cy-42),'espOS',font=font(42,True),fill=white)
d.text((cx-58,cy+25),'ESP32-S3',font=mono(19),fill=cyan)
d.text((793,569),'FLASH · APPS · REPL',font=mono(18),fill=muted)
out=root/'packages/web/public/og-espos-studio-v2.png'
im.save(out,optimize=True)
print(out)