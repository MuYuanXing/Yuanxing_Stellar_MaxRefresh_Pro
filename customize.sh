#!/system/bin/sh
#Frost_Bai
#amend
SKIPUNZIP=1

ui_print "- 解压模块文件..."
unzip -o "$ZIPFILE" -d $MODPATH >&2

set_perm_recursive $MODPATH 0 0 0755 0644
set_perm $MODPATH/service.sh 0 0 0755
set_perm $MODPATH/post-fs-data.sh 0 0 0755
set_perm $MODPATH/uninstall.sh 0 0 0755
set_perm $MODPATH/setup_extras.sh 0 0 0755

MODULE_NAME=$(grep -E '^name=' "$MODPATH/module.prop" | cut -d'=' -f2-)
MODULE_VERSION=$(grep -E '^version=' "$MODPATH/module.prop" | cut -d'=' -f2-)

ui_print "***********************************************"
ui_print " $MODULE_NAME $MODULE_VERSION"
ui_print " 作者: 酷安@穆远星"
ui_print "***********************************************"

GETPROP="/system/bin/getprop"

ui_print "- 正在检测设备品牌..."

DEVICE_BRAND=$("$GETPROP" ro.product.vendor.brand)
[ -z "$DEVICE_BRAND" ] && DEVICE_BRAND=$("$GETPROP" ro.product.brand)
DEVICE_BRAND=$(echo "$DEVICE_BRAND" | tr '[:upper:]' '[:lower:]')

BRAND_OK=0
if echo "$DEVICE_BRAND" | grep -qiE "oneplus|oppo|realme|oplus"; then
    BRAND_OK=1
fi

if [ "$BRAND_OK" -eq 0 ]; then
    ui_print " "
    ui_print "❌ 设备品牌监测失败!"
    ui_print "---------------------------------------------"
    ui_print "监测到的品牌: $DEVICE_BRAND"
    ui_print "---------------------------------------------"
    ui_print "此模块仅支持: OnePlus / OPPO / Realme"
    ui_print "安装已取消!"
    ui_print "============================================="
    abort "设备不兼容"
fi

ui_print "✓ 品牌监测通过: $DEVICE_BRAND"

ui_print "- 正在激活并监测刷新率档位..."

for i in 0 1 2 3 4 5 6 7 8 9 10; do
    service call SurfaceFlinger 1035 i32 $i >/dev/null 2>&1
    usleep 100000
done

sleep 1

LIST_FRAMEWORK=$(dumpsys display | grep -oE "fps=[0-9.]+" | awk -F= '{print $2}')
LIST_SF=$(dumpsys SurfaceFlinger | grep -oE "fps[=:][0-9.]+" | awk -F'[=:]' '{print $2}')
ALL_RATES="$LIST_FRAMEWORK $LIST_SF"
DETECTED=$(echo "$ALL_RATES" | tr ' ' '\n' | awk '{if($1>=30) printf("%.0f\n", $1)}' | sort -n | uniq)

RATES=$(echo "$DETECTED" | xargs)

ui_print "---------------------------------------------"
ui_print "• 设备厂商: $DEVICE_BRAND"
if [ -z "$RATES" ]; then
    ui_print "• 支持刷新率: 未检测到有效档位"
else
    ui_print "• 支持刷新率: $RATES"
fi
ui_print "---------------------------------------------"

MODID="Yuanxing_Stellar_MaxRefresh_Pro"
PERSISTENT_DIR="/data/adb/${MODID}_data"
mkdir -p "$PERSISTENT_DIR"
set_perm "$PERSISTENT_DIR" 0 0 0755

if [ -f "$PERSISTENT_DIR/saved_config" ]; then
    cp -f "$PERSISTENT_DIR/saved_config" "$MODPATH/saved_config"
else
    touch "$MODPATH/saved_config"
fi

if [ -f "$PERSISTENT_DIR/apps.conf" ]; then
    cp -f "$PERSISTENT_DIR/apps.conf" "$MODPATH/apps.conf"
else
    touch "$MODPATH/apps.conf"
fi

set_perm "$MODPATH/saved_config" 0 0 0644
set_perm "$MODPATH/apps.conf" 0 0 0644

sh "$MODPATH/setup_extras.sh"

ui_print "***********************************************"
ui_print "✅ 安装完成！请重启设备使模块生效"
ui_print "***********************************************"