#!/system/bin/sh
MODDIR=${0%/*}

rm -rf "/data/adb/Yuanxing_Stellar_MaxRefresh_Pro_data"
rm -rf /data/local/tmp/Yuanxing_*

resetprop --delete persist.oplus.display.vrr
resetprop --delete persist.oplus.display.vrr.adfr
resetprop --delete debug.oplus.display.dynamic_fps_switch
resetprop --delete sys.display.vrr.vote.support
resetprop --delete vendor.display.enable_dpps_dynamic_fps
resetprop --delete ro.display.brightness.brightness.mode
resetprop --delete debug.egl.swapinterval
resetprop --delete ro.surface_flinger.use_content_detection_for_refresh_rate
resetprop --delete vendor.display.enable_optimize_refresh

settings delete system peak_refresh_rate 2>/dev/null
settings delete system min_refresh_rate 2>/dev/null
settings delete system user_refresh_rate 2>/dev/null