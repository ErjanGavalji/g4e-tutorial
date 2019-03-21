#!/usr/bin/bash
srcFiles=./start/configs/chapter-1/*applications.json
destDir=~/AppData/Local/Tick42/GlueDesktop/config/apps

cp $srcFiles $destDir/
