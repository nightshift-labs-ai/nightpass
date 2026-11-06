#!/usr/bin/env bash
# Rebuild docs/nightpass-demo.mp4: slides (docs/slides.html) + live demo recording + Piper voice-over + subtitles.
set -euo pipefail
cd "$(dirname "$0")/.."; ROOT=$PWD; W=/tmp/npvid; rm -rf $W; mkdir -p $W
FF=/home/agent/tools/ffmpeg/ffmpeg; export LD_LIBRARY_PATH=/home/agent/tools/libroot/usr/lib/x86_64-linux-gnu
URL=${URL:-https://nightpass-demo.nightshift-labs.workers.dev/}
node tools/recdemo.mjs "$URL" $W >/dev/null
for i in 0 1 2 3 4 5 7 8; do node tools/sshot.mjs $ROOT/docs/slides.html $W/slide$i.png $i; done
seg(){ $FF -y -loglevel error -loop 1 -t $2 -i $W/slide$1.png -vf "scale=1280:720,format=yuv420p" -r 30 -c:v libx264 -preset veryfast -crf 20 $W/s$1.mp4; }
seg 0 8; seg 1 13; seg 2 15; seg 3 13; seg 4 13; seg 5 12; seg 7 14; seg 8 14
$FF -y -loglevel error -i $W/*.webm -t 33 -vf "scale=1088:612,pad=1280:720:96:0:color=0x0b0d17,format=yuv420p" -r 30 -c:v libx264 -preset veryfast -crf 20 $W/demo.mp4
printf "file s0.mp4\nfile s1.mp4\nfile s2.mp4\nfile s3.mp4\nfile s4.mp4\nfile s5.mp4\nfile demo.mp4\nfile s7.mp4\nfile s8.mp4\n" > $W/list.txt
$FF -y -loglevel error -f concat -safe 0 -i $W/list.txt -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 $W/raw.mp4
python3 /home/agent/claude-money/tools/narrate.py $W/raw.mp4 docs/video-script.txt $W/voiced.mp4 >/dev/null
sed -e 's/x four oh two/x402/' $W/voiced.srt > docs/nightpass-demo.srt
$FF -y -loglevel error -i $W/voiced.mp4 -vn -c:a copy $W/voice.m4a
$FF -y -loglevel error -i $W/raw.mp4 -i $W/voice.m4a -filter_complex "[0:v]subtitles='$ROOT/docs/nightpass-demo.srt':force_style='FontName=DejaVu Sans,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=12'[v]" -map "[v]" -map 1:a -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a copy -movflags +faststart docs/nightpass-demo.mp4
/home/agent/tools/ffmpeg/ffprobe -v error -show_entries stream=codec_type,duration -of csv=p=0 docs/nightpass-demo.mp4
