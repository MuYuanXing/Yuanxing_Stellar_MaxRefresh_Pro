#!/system/bin/sh
MODDIR=${0%/*}
CONFIG_FILE="$MODDIR/saved_config"
APPS_FILE="$MODDIR/apps.conf"
RATES_CACHE="$MODDIR/rates_cache"

CURRENT_ID=""
CURRENT_TYPE=""
SAVED_ID=""
SAVED_FPS=""
BASE_120_ID=""
BASE_165_ID=""
MAX_ID=""

config_mtime=0
apps_mtime=0
SCREEN_STATE="on"
LAST_SCREEN_STATE="on"

DEVICE_MODEL=""
IS_NATIVE_165_DEVICE=0
NATIVE_MAX_FPS=120

wait_boot_complete() {
    until [ "$(getprop sys.boot_completed)" = "1" ]; do
        sleep 1
    done
}

detect_device_model() {
    DEVICE_MODEL=$(getprop ro.product.model)
    [ -z "$DEVICE_MODEL" ] && DEVICE_MODEL=$(getprop ro.product.odm.model)
    
    case "$DEVICE_MODEL" in
        PLQ110|PLK110|PLR110|OPD2413)
            IS_NATIVE_165_DEVICE=1
            NATIVE_MAX_FPS=165
            ;;
        PLC110)
            IS_NATIVE_165_DEVICE=1
            NATIVE_MAX_FPS=144
            ;;
        *)
            IS_NATIVE_165_DEVICE=0
            NATIVE_MAX_FPS=120
            ;;
    esac
}

get_screen_state() {
    local state=$(dumpsys power 2>/dev/null | grep -oE "mWakefulness=[A-Za-z]+" | head -n1 | cut -d= -f2)
    case "$state" in
        Awake) echo "on" ;;
        *) echo "off" ;;
    esac
}

init_rates() {
    sleep 1
    
    dumpsys display 2>/dev/null | grep -oE "\{id=[0-9]+, width=[0-9]+, height=[0-9]+, fps=[0-9.]+" | sort -u > "$RATES_CACHE"
    
    BASE_120_ID=$(awk -F'[,=]' '{
        id=$2; fps=$8
        if (fps >= 119 && fps <= 122) print id
    }' "$RATES_CACHE" | head -n1)
    
    BASE_165_ID=$(awk -F'[,=]' '{
        id=$2; fps=$8
        if (fps >= 164 && fps <= 166) print id
    }' "$RATES_CACHE" | head -n1)
    
    MAX_ID=$(awk -F'[,=]' '{print $2}' "$RATES_CACHE" | sort -n | tail -n1)
    
    if [ -z "$BASE_120_ID" ]; then
        BASE_120_ID=1
    fi
    
    if [ -z "$MAX_ID" ]; then
        MAX_ID=10
    fi
    
    CURRENT_ID="$BASE_120_ID"
}

get_fps_by_id() {
    local target_id=$1
    local fps=$(awk -F'[,=]' -v tid="$target_id" '$2==tid {printf "%.0f", $8}' "$RATES_CACHE" | head -n1)
    echo "${fps:-0}"
}

need_screen_restore() {
    local target_id=$1
    local target_fps=$(get_fps_by_id "$target_id")
    
    if [ "$IS_NATIVE_165_DEVICE" -eq 1 ]; then
        if [ "$target_fps" -le "$NATIVE_MAX_FPS" ]; then
            return 1
        fi
    fi
    
    return 0
}

need_ramp_switch() {
    local target_fps=$1
    local current_fps=$2
    
    if [ "$IS_NATIVE_165_DEVICE" -eq 1 ]; then
        if [ "$target_fps" -le "$NATIVE_MAX_FPS" ] && [ "$current_fps" -le "$NATIVE_MAX_FPS" ]; then
            return 1
        fi
    fi
    
    if [ "$target_fps" -gt 120 ] || [ "$current_fps" -gt 120 ]; then
        return 0
    fi
    
    return 1
}

apply_logic() {
    local target=$1
    local type=$2
    local force=$3
    
    if [ "$force" != "1" ]; then
        if [ "$target" = "$CURRENT_ID" ] && [ "$type" = "$CURRENT_TYPE" ]; then
            return
        fi
    fi
    
    if [ "$type" = "id" ]; then
        settings put system peak_refresh_rate 240.0 2>/dev/null
        settings put system min_refresh_rate 10.0 2>/dev/null
        
        local target_id="$target"
        local target_fps=$(get_fps_by_id "$target_id")
        local current_id="${CURRENT_ID:-$BASE_120_ID}"
        local current_fps=$(get_fps_by_id "$current_id")
        
        if need_ramp_switch "$target_fps" "$current_fps"; then
            if [ "$target_id" -gt "$current_id" ]; then
                local start_id="$current_id"
                if [ "$start_id" -lt "$BASE_120_ID" ]; then
                    start_id="$BASE_120_ID"
                fi
                local i="$start_id"
                while [ "$i" -le "$target_id" ]; do
                    local sf_id=$((i - 1))
                    service call SurfaceFlinger 1035 i32 "$sf_id" > /dev/null 2>&1
                    usleep 50000
                    i=$((i + 1))
                done
            elif [ "$target_id" -lt "$current_id" ]; then
                local i="$current_id"
                while [ "$i" -ge "$target_id" ]; do
                    local sf_id=$((i - 1))
                    service call SurfaceFlinger 1035 i32 "$sf_id" > /dev/null 2>&1
                    usleep 50000
                    i=$((i - 1))
                done
            else
                local sf_id=$((target_id - 1))
                service call SurfaceFlinger 1035 i32 "$sf_id" > /dev/null 2>&1
            fi
        else
            local sf_id=$((target_id - 1))
            service call SurfaceFlinger 1035 i32 "$sf_id" > /dev/null 2>&1
        fi
        
        CURRENT_ID="$target_id"
        CURRENT_TYPE="id"
    else
        settings put system peak_refresh_rate "$target" 2>/dev/null
        settings put system min_refresh_rate "$target" 2>/dev/null
        CURRENT_ID=""
        CURRENT_TYPE="fps"
    fi
}

wait_boot_complete
detect_device_model
init_rates

if [ -f "$CONFIG_FILE" ]; then
    SAVED_ID=$(cat "$CONFIG_FILE" 2>/dev/null | awk '{print $1}' | tr -d ' \n')
    SAVED_FPS=$(cat "$CONFIG_FILE" 2>/dev/null | awk '{print $2}' | tr -d ' \n')
    config_mtime=$(stat -c %Y "$CONFIG_FILE" 2>/dev/null)
fi

if [ -f "$APPS_FILE" ]; then
    apps_mtime=$(stat -c %Y "$APPS_FILE" 2>/dev/null)
fi

if [ -n "$SAVED_ID" ]; then
    apply_logic "$SAVED_ID" "id" "1"
elif [ -n "$SAVED_FPS" ]; then
    apply_logic "$SAVED_FPS" "fps" "1"
fi

while true; do
    SCREEN_STATE=$(get_screen_state)
    
    if [ "$SCREEN_STATE" = "on" ] && [ "$LAST_SCREEN_STATE" = "off" ]; then
        if [ -n "$SAVED_ID" ]; then
            if need_screen_restore "$SAVED_ID"; then
                CURRENT_ID="$BASE_120_ID"
                apply_logic "$SAVED_ID" "id" "1"
            fi
        elif [ -n "$SAVED_FPS" ]; then
            apply_logic "$SAVED_FPS" "fps" "1"
        fi
    fi
    LAST_SCREEN_STATE="$SCREEN_STATE"
    
    if [ "$SCREEN_STATE" = "off" ]; then
        sleep 1
        continue
    fi
    
    if [ -f "$CONFIG_FILE" ]; then
        current_config_mtime=$(stat -c %Y "$CONFIG_FILE" 2>/dev/null)
        if [ "$current_config_mtime" != "$config_mtime" ]; then
            SAVED_ID=$(cat "$CONFIG_FILE" 2>/dev/null | awk '{print $1}' | tr -d ' \n')
            SAVED_FPS=$(cat "$CONFIG_FILE" 2>/dev/null | awk '{print $2}' | tr -d ' \n')
            config_mtime="$current_config_mtime"
        fi
    fi
    
    if [ -f "$APPS_FILE" ]; then
        current_apps_mtime=$(stat -c %Y "$APPS_FILE" 2>/dev/null)
        if [ "$current_apps_mtime" != "$apps_mtime" ]; then
            apps_mtime="$current_apps_mtime"
        fi
    fi
    
    FOCUS_APP=$(dumpsys activity activities 2>/dev/null | grep -E "topResumedActivity=|mResumedActivity=" | tail -n1 | sed 's/.*{\([^}]*\)}.*/\1/' | cut -d'/' -f1 | awk '{print $NF}')
    
    APP_CONFIG=""
    if [ -f "$APPS_FILE" ] && [ -n "$FOCUS_APP" ]; then
        APP_CONFIG=$(grep "^${FOCUS_APP}=" "$APPS_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')
    fi
    
    if [ -n "$APP_CONFIG" ]; then
        apply_logic "$APP_CONFIG" "id"
    else
        if [ -n "$SAVED_ID" ]; then
            apply_logic "$SAVED_ID" "id"
        elif [ -n "$SAVED_FPS" ]; then
            apply_logic "$SAVED_FPS" "fps"
        fi
    fi
    
    sleep 1
done
