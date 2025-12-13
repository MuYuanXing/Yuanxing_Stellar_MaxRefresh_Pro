class StellarEngine {
    constructor() {
        this.modDir = '/data/adb/modules/Yuanxing_Stellar_LTPO';
        this.configFile = `${this.modDir}/saved_config`;
        this.appsFile = `${this.modDir}/apps.conf`;
        this.ratesCache = `${this.modDir}/rates_cache`;
        this.rateMap = [];
        this.selectedRate = null;
        this.currentId = null;
        this.base120Id = null;
        this.base165Id = null;
        this.isNative165Device = false;
        this.nativeMaxFps = 120;
        this.appConfigs = [];
        this.init();
    }

    init() {
        this.loadDeviceInfo();
        this.loadRatesPassive();
        this.loadAppConfigs();
        this.loadCurrentConfig();
        this.bindEvents();
        this.injectScanButton();
    }

    bindEvents() {
        document.querySelectorAll('.tab-item').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.switchPage(page);
            });
        });

        document.getElementById('save-rate').addEventListener('click', () => {
            this.saveRateConfig();
        });

        document.getElementById('add-app-config').addEventListener('click', () => {
            this.showInputModal();
        });

        document.getElementById('input-cancel').addEventListener('click', () => {
            this.hideInputModal();
        });

        document.getElementById('input-done').addEventListener('click', () => {
            this.addAppConfig();
        });

        document.getElementById('coolapk-link').addEventListener('click', () => {
            this.openCoolapk();
        });

        document.getElementById('qq-link').addEventListener('click', () => {
            this.openQQGroup();
        });
    }

    injectScanButton() {
        const header = document.querySelector('#rate-selector').previousElementSibling;
        if (header && header.classList.contains('card-header')) {
            const existingBtn = header.querySelector('.scan-btn');
            if (existingBtn) existingBtn.remove();

            const btn = document.createElement('span');
            btn.className = 'card-action scan-btn';
            btn.textContent = '全量扫描';
            btn.style.marginRight = '10px';
            btn.onclick = () => {
                this.showConfirmModal(
                    '全量扫描',
                    '此操作将快速切换所有刷新率档位，屏幕可能会闪烁。是否继续？',
                    () => this.forceProbeRates()
                );
            };

            const saveBtn = document.getElementById('save-rate');
            header.insertBefore(btn, saveBtn);
        }
    }

    showConfirmModal(title, message, onConfirm) {
        const existing = document.getElementById('dynamic-confirm-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'dynamic-confirm-modal';
        modal.className = 'ui-modal show';

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="justify-content:center; border-bottom:0;">
                    <span class="modal-title">${title}</span>
                </div>
                <div class="modal-text-content">
                    ${message}
                </div>
                <div class="modal-footer">
                    <div class="modal-btn cancel" id="confirm-cancel">取消</div>
                    <div class="modal-btn danger" id="confirm-ok">继续</div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('confirm-cancel').onclick = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
        };

        document.getElementById('confirm-ok').onclick = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
            onConfirm();
        };
    }

    async exec(cmd) {
        return new Promise((resolve) => {
            const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            let timeout = setTimeout(() => {
                delete window[callback];
                resolve('');
            }, 5000);

            window[callback] = (code, stdout, stderr) => {
                clearTimeout(timeout);
                delete window[callback];
                resolve(stdout ? stdout.trim() : '');
            };

            try {
                ksu.exec(cmd, "{}", callback);
            } catch (e) {
                clearTimeout(timeout);
                delete window[callback];
                resolve('');
            }
        });
    }

    async loadCurrentConfig() {
        const content = await this.exec(`/system/bin/cat ${this.configFile} 2>/dev/null`);
        if (content) {
            const id = parseInt(content.trim());
            if (!isNaN(id) && id > 0) {
                this.currentId = id;
                
                setTimeout(() => {
                    const activeItem = document.querySelector(`[data-id="${id}"]`);
                    if (activeItem) {
                        activeItem.classList.add('active');
                        this.selectedRate = {
                            id: id,
                            fps: parseInt(activeItem.dataset.fps)
                        };
                    }
                }, 500);
            }
        }
    }

    async loadRatesPassive() {
        await this.parseAndRenderRates();
    }

    async forceProbeRates() {
        this.showToast('正在扫描档位...');
        for (let i = 0; i <= 15; i++) {
            await this.exec(`/system/bin/service call SurfaceFlinger 1035 i32 ${i}`);
        }
        await this.sleep(500);
        await this.parseAndRenderRates();
        this.showToast('扫描完成');
    }

    async parseAndRenderRates() {
        const cmd = `/system/bin/dumpsys display | /system/bin/grep -oE "\\{id=[0-9]+, width=[0-9]+, height=[0-9]+, fps=[0-9.]+" | /system/bin/sort -u`;
        const raw = await this.exec(cmd);
        const lines = raw.split('\n').filter(l => l.trim());

        this.rateMap = lines.map(line => {
            const id = line.match(/id=(\d+)/)?.[1];
            const width = line.match(/width=(\d+)/)?.[1];
            const height = line.match(/height=(\d+)/)?.[1];
            const fps = line.match(/fps=([0-9.]+)/)?.[1];

            return {
                id: parseInt(id),
                width,
                height,
                fps: Math.round(parseFloat(fps)),
                rawFps: parseFloat(fps)
            };
        }).filter(item => item.id && item.fps);

        this.rateMap.sort((a, b) => {
            if (a.fps !== b.fps) return a.fps - b.fps;
            return parseInt(a.width) - parseInt(b.width);
        });

        this.base120Id = null;
        this.base165Id = null;
        
        for (const item of this.rateMap) {
            if (item.fps >= 119 && item.fps <= 122) {
                this.base120Id = item.id;
            }
            if (item.fps >= 164 && item.fps <= 166) {
                this.base165Id = item.id;
            }
        }
        
        if (!this.base120Id && this.rateMap.length > 0) {
            this.base120Id = this.rateMap[0].id;
        }

        const rates = [...new Set(this.rateMap.map(r => r.fps))].sort((a, b) => a - b);
        document.getElementById('supported-rates').textContent = rates.length > 0 ? rates.join(', ') + 'Hz' : 'Hz';

        const infoVal = document.getElementById('supported-rates');
        if (infoVal && !infoVal.parentNode.nextElementSibling?.classList.contains('info-note')) {
            const note = document.createElement('div');
            note.className = 'info-note';
            note.textContent = '注意：初次配置请务必执行全量扫描，确保所有档位被激活。';
            infoVal.parentNode.parentNode.insertBefore(note, infoVal.parentNode.nextSibling);
        }

        this.renderRateSelector();
        this.renderIdMap();
    }

    async loadDeviceInfo() {
        try {
            const model = await this.exec('/system/bin/getprop ro.product.model');
            const market = await this.exec('/system/bin/getprop ro.vendor.oplus.market.name');
            const android = await this.exec('/system/bin/getprop ro.build.version.release');
            const kernel = await this.exec('/system/bin/uname -r');
            const battery = await this.exec('/system/bin/cat /sys/class/power_supply/battery/capacity');
            const temp = await this.exec('/system/bin/cat /sys/class/power_supply/battery/temp');

            document.getElementById('device-model').textContent = model || '未知';
            document.getElementById('market-name').textContent = market || model || '未知';
            document.getElementById('android-ver').textContent = android ? `Android ${android}` : 'Android';
            document.getElementById('kernel-ver').textContent = kernel || '未知';
            document.getElementById('battery-level').textContent = battery ? `${battery}%` : '未知';

            if (temp && !isNaN(temp)) {
                const tempC = Math.round(parseInt(temp) / 10);
                document.getElementById('battery-temp').textContent = `${tempC}°C`;
            } else {
                document.getElementById('battery-temp').textContent = '未知';
            }

            const devHeader = document.getElementById('device-model').closest('.glass-card').querySelector('.card-header');
            if (devHeader) {
                devHeader.style.justifyContent = 'center';
            }

            if (model.match(/^(PLQ110|PLK110|PLR110|OPD2413)$/)) {
                this.isNative165Device = true;
                this.nativeMaxFps = 165;
            }
            else if (model.match(/^PLC110$/)) {
                this.isNative165Device = true;
                this.nativeMaxFps = 144;
}

        } catch (e) {
            console.error('loadDeviceInfo error:', e);
        }
    }

    renderRateSelector() {
        const container = document.getElementById('rate-selector');
        container.innerHTML = this.rateMap.map(item => `
            <div class="rate-item" data-id="${item.id}" data-fps="${item.fps}">
                <span class="rate-label">${item.fps}Hz</span>
                <span class="rate-id">${item.width}x${item.height} (ID:${item.id})</span>
            </div>
        `).join('');

        container.querySelectorAll('.rate-item').forEach(el => {
            el.addEventListener('click', (e) => {
                container.querySelectorAll('.rate-item').forEach(r => r.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.selectedRate = {
                    id: parseInt(e.currentTarget.dataset.id),
                    fps: parseInt(e.currentTarget.dataset.fps)
                };
            });
        });
    }

    renderIdMap() {
        const container = document.getElementById('id-map-table');
        container.innerHTML = this.rateMap.map(item => `
            <div class="map-row">
                <span class="map-rate">${item.fps}Hz <span class="map-res">${item.width}x${item.height}</span></span>
                <span class="map-id">ID = ${item.id}</span>
            </div>
        `).join('');
    }

    async saveRateConfig() {
        if (!this.selectedRate) {
            this.showToast('请选择刷新率');
            return;
        }

        const { id: targetId, fps: targetFps } = this.selectedRate;
        
        await this.exec(`/system/bin/echo "${targetId}" > ${this.configFile}`);

        const currentId = this.currentId || this.base120Id || 1;
        const currentItem = this.rateMap.find(r => r.id === currentId);
        const currentFps = currentItem ? currentItem.fps : 0;

        let needRamp = false;
        let baseId = this.base120Id;
        
        if (this.isNative165Device) {
            needRamp = targetFps > 165 || currentFps > 165;
            if (targetFps > 165) {
                baseId = this.base165Id || this.base120Id;
            }
        } else {
            needRamp = targetFps > 120 || currentFps > 120;
        }

        if (needRamp) {
            if (targetId > currentId) {
                let startId = currentId < baseId ? baseId : currentId;
                for (let i = startId; i <= targetId; i++) {
                    await this.exec(`/system/bin/service call SurfaceFlinger 1035 i32 ${i - 1}`);
                }
            } else if (targetId < currentId) {
                for (let i = currentId; i >= targetId; i--) {
                    await this.exec(`/system/bin/service call SurfaceFlinger 1035 i32 ${i - 1}`);
                }
            } else {
                await this.exec(`/system/bin/service call SurfaceFlinger 1035 i32 ${targetId - 1}`);
            }
        } else {
            await this.exec(`/system/bin/service call SurfaceFlinger 1035 i32 ${targetId - 1}`);
        }

        this.currentId = targetId;
        this.showToast(`已保存: ${targetFps}Hz (ID:${targetId})`);
    }

    async loadAppConfigs() {
        const content = await this.exec(`/system/bin/cat ${this.appsFile} 2>/dev/null | /system/bin/grep -v '^#' | /system/bin/grep '='`);
        this.appConfigs = content.split('\n').filter(l => l.includes('=')).map(line => {
            const [pkg, id] = line.split('=');
            return { pkg: pkg.trim(), id: id.trim() };
        }).filter(c => c.pkg && c.id);
        this.renderAppConfigs();
    }

    renderAppConfigs() {
        const container = document.getElementById('app-config-list');
        if (this.appConfigs.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#8E8E93">暂无配置</div>';
            return;
        }

        container.innerHTML = this.appConfigs.map((config, idx) => `
            <div class="config-item">
                <span class="config-pkg">${config.pkg}</span>
                <span class="config-id">ID: ${config.id}</span>
                <span class="config-delete" data-idx="${idx}">删除</span>
            </div>
        `).join('');

        container.querySelectorAll('.config-delete').forEach(el => {
            el.addEventListener('click', async (e) => {
                const idx = e.target.dataset.idx;
                this.appConfigs.splice(idx, 1);
                await this.saveAppConfigs();
                this.renderAppConfigs();
            });
        });
    }

    async saveAppConfigs() {
        const header = `# ==========================================
# 星驰引擎(禁用LTPO) - 应用独立刷新率配置
# 填写 主页中监测到的刷新率 ID 档位
# 示例: com.tencent.tmgp.sgame=4(王者荣耀=4)(一加Ace6 144Hz档位)
# ==========================================`;
        const content = header + '\n' + this.appConfigs.map(c => `${c.pkg}=${c.id}`).join('\n');
        await this.exec(`/system/bin/echo '${content}' > ${this.appsFile}`);
    }

    showInputModal() {
        document.getElementById('app-input-modal').classList.add('show');
        document.getElementById('app-package').value = '';
        document.getElementById('app-rate-id').value = '';
        setTimeout(() => document.getElementById('app-package').focus(), 100);
    }

    hideInputModal() {
        document.getElementById('app-input-modal').classList.remove('show');
    }

    async addAppConfig() {
        const pkg = document.getElementById('app-package').value.trim();
        const id = document.getElementById('app-rate-id').value.trim();

        if (!pkg || !id) {
            this.showToast('请填写完整信息');
            return;
        }

        this.appConfigs.push({ pkg, id });
        await this.saveAppConfigs();
        this.renderAppConfigs();
        this.hideInputModal();
        this.showToast('配置已添加');
    }

    switchPage(page) {
        document.querySelectorAll('.ui-content').forEach(p => p.classList.add('hidden'));

        const targetPage = document.getElementById(`page-${page}`);
        targetPage.classList.remove('hidden');

        if (page === 'home') {
            targetPage.style.justifyContent = 'flex-start';
        } else {
            targetPage.style.justifyContent = 'center';
        }

        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-page="${page}"]`).classList.add('active');
    }

    async openCoolapk() {
        await this.exec('/system/bin/am start -a android.intent.action.VIEW -d "http://www.coolapk.com/u/28719807"');
        this.showToast('正在打开酷安...');
    }

    async openQQGroup() {
        const url = 'https://qun.qq.com/universal-share/share?ac=1&authKey=%2FTGXCSmJqVxUBWEry7%2Fj5yyTp91URzS3lfjYavmMrA%2BOYMRVSGEaryIk8XID678s&busi_data=eyJncm91cENvZGUiOiIxMDYyMzM1ODk1IiwidG9rZW4iOiJNYkZWeE9CcUhxSE0waWlZMTVBbGJvUUdpdTRVZ24zMUlheC9Bd00rM2NhVDk2T3hCbTNUQldRSnBXVXk0akp1IiwidWluIjoiMzg5NDM3NDc0MSJ9&data=z6YmQ56hityzX99ash8MVa2yrN9uI02C4eh6YVPljfNdT4uMsmHgRC9FRX24q3CwJV1xkyxmIx4dR1RGTvPkyQ&svctype=4&tempid=h5_group_info';
        await this.exec(`/system/bin/am start -a android.intent.action.VIEW -d "${url}"`);
        this.showToast('正在打开QQ群...');
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

document.addEventListener('DOMContentLoaded', () => new StellarEngine());
