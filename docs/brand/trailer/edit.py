import subprocess, imageio_ffmpeg, os
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs("seg", exist_ok=True)
ENC = ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30"]
def run(a): subprocess.run([FF, "-y", "-loglevel", "error", *a], check=True)
BAND, WH, HDR = 320, 1030, 143   # HDR: the app header (57 CSS px) at 2.5x; it stays locked while the content pushes
SHOTS = [  # name, seconds, zoom start, zoom end, anchor x, anchor y (share of spare width and height); match capture.mjs
    ("predict", 2.2, 1.00, 1.06, 0.5, 0.70),   # anchor 0.70 keeps the Yes/No row near still and the question clear of the header
    ("compete", 2.8, 1.00, 1.00, 0.5, 0.0),
    ("check",   2.6, 1.00, 1.00, 0.5, 0.0),
]
END, X = 3.5, 0.13                # END matches gfx.mjs
def shot(name, dur, z0, z1, ax, ay):
    z = f"({z0}+({z1}-{z0})*t/{dur})"
    vf = (f"[0:v]format=yuv420p,split[s1][s2];"
          f"[s1]scale=1080:{WH}:flags=lanczos,crop=1080:{HDR}:0:0[hd];"
          f"[s2]scale=w='2*trunc(540*{z})':h='2*trunc(515*{z})':eval=frame:flags=lanczos,"
          f"crop=1080:{WH}:x='(2*trunc(540*{z})-1080)*{ax}':y='(2*trunc(515*{z})-{WH})*{ay}',setsar=1[ui];"   # iw/ih stay at the first frame's size, so the anchor is computed from z
          f"color=c=0x0a0908:s=1080x1350:r=30:d={dur}[bg];[bg][ui]overlay=0:{BAND}[a];[a][hd]overlay=0:{BAND}[b];"
          f"[b][1:v]overlay=0:0,format=yuv420p[v]")
    run(["-framerate", "30", "-i", f"shots/{name}/%05d.jpg",
         "-loop", "1", "-framerate", "30", "-t", str(dur), "-i", f"gfx/frame-{name}.png",
         "-filter_complex", vf, "-map", "[v]", "-t", str(dur), *ENC, f"seg/{name}.mp4"])
for s in SHOTS: shot(*s)
run(["-framerate", "30", "-i", "gfx/end/%04d.jpg", "-t", str(END), *ENC, "seg/end.mp4"])
ins = []
for o in [s[0] for s in SHOTS] + ["end"]: ins += ["-i", f"seg/{o}.mp4"]
games = sum(s[1] for s in SHOTS)
fc = (f"[0:v][1:v][2:v]concat=n=3:v=1:a=0,settb=AVTB,fps=30[g];[3:v]settb=AVTB,fps=30[e];"   # hard cuts between games
      f"[g][e]xfade=transition=fade:duration={X}:offset={games - X:.3f}[v]")                  # one dissolve, into the end card
run([*ins, "-filter_complex", fc, "-map", "[v]", *ENC, "-movflags", "+faststart", "dulo-trailer-v4-4x5.mp4"])
