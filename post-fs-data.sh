#!/system/bin/sh
MODDIR=${0%/*}
resetprop -n persist.oplus.display.vrr 0
resetprop -n persist.oplus.display.vrr.adfr 0
resetprop -n debug.oplus.display.dynamic_fps_switch 0
resetprop -n sys.display.vrr.vote.support 0
resetprop -n vendor.display.enable_dpps_dynamic_fps 0
resetprop -n ro.display.brightness.brightness.mode 1
setprop debug.egl.swapinterval 1