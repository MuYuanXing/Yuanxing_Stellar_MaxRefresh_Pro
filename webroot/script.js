class StellarEngine {
    constructor() {
        this.defaultId = 'Yuanxing_Stellar_MaxRefresh_Pro';
        this.moduleId = this.defaultId;
        this.mod = `/data/adb/modules/${this.defaultId}`;
        this.pdir = `/data/adb/${this.defaultId}_data`;
        this.ltpoMode = '';
        this.rates = [];
        this.apps = [];
        this.conf = { rateId: null, appSw: true, appIntv: 1 };
        this.curId = null;
        this.init();
    }

    cleanStr(v) { return String(v ?? '').trim(); }

    safeModuleId(v) {
        const s = this.cleanStr(v);
        if (!s) return '';
        return /^[A-Za-z0-9._-]+$/.test(s) ? s : '';
    }

    safeModuleDir(v) {
        const s = this.cleanStr(v);
        if (!s) return '';
        return s.startsWith('/data/adb/modules/') ? s : '';
    }

    parseModuleInfo(v) {
        if (!v) return null;
        if (typeof v === 'object') return v;
        if (typeof v !== 'string') return null;
        const s = v.trim();
        if (!s) return null;
        if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
            try { return JSON.parse(s); } catch (e) {}
        }
        return { id: s };
    }

    loadModuleInfo() {
        try {
            if (!window.ksu || typeof ksu.moduleInfo !== 'function') return;
            const raw = ksu.moduleInfo();
            const info = this.parseModuleInfo(raw);
            if (!info) return;

            const moduleDir = this.safeModuleDir(info.moduleDir || info.module_dir);
            const moduleId = this.safeModuleId(info.id || info.moduleId || info.module_id);

            if (moduleDir) this.mod = moduleDir;
            if (moduleId) {
                this.moduleId = moduleId;
                this.pdir = `/data/adb/${moduleId}_data`;
                if (!moduleDir) this.mod = `/data/adb/modules/${moduleId}`;
            }
        } catch (e) {}
    }

    escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    shQuote(s) {
        const v = String(s);
        return `'${v.replace(/'/g, `'\"'\"'`)}'`;
    }

    normalizeOutput(v) {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') {
            if (typeof v.stdout === 'string') return v.stdout;
            if (typeof v.stderr === 'string') return v.stderr;
            try { return JSON.stringify(v); } catch (e) { return String(v); }
        }
        return String(v);
    }

    b64EncodeUtf8(s) {
        const v = String(s ?? '');
        try {
            if (typeof TextEncoder === 'function') {
                const bytes = new TextEncoder().encode(v);
                let binary = '';
                const chunk = 0x8000;
                for (let i = 0; i < bytes.length; i += chunk) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                return btoa(binary);
            }
        } catch (e) {}
        try {
            return btoa(unescape(encodeURIComponent(v)));
        } catch (e) {}
        return btoa(v);
    }

    firstLine(s) {
        const v = (s || '').toString().trim();
        if (!v) return '';
        const l = v.split('\n').map(x => x.trim()).find(x => x);
        return l || '';
    }

    cut(s, maxLen = 140) {
        const v = String(s ?? '');
        if (v.length <= maxLen) return v;
        return v.slice(0, maxLen - 1) + '…';
    }

    toastErr(prefix, res) {
        const e = this.firstLine(res?.stderr);
        const n = (res && typeof res.errno !== 'undefined') ? res.errno : '?';
        const msg = e ? `${prefix}失败(errno=${n}): ${e}` : `${prefix}失败(errno=${n})`;
        this.toast(this.cut(msg));
    }

    async execFull(cmd, timeoutMs = 8000) {
        return new Promise(resolve => {
            const cb = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            let done = false;
            const finish = (res) => {
                if (done) return;
                done = true;
                try { delete window[cb]; } catch (e) {}
                resolve(res);
            };
            const tm = setTimeout(() => {
                finish({ errno: 124, stdout: '', stderr: 'timeout' });
            }, timeoutMs);
            window[cb] = (errno, stdout, stderr) => {
                clearTimeout(tm);
                finish({
                    errno: typeof errno === 'number' ? errno : parseInt(errno || 0),
                    stdout: this.normalizeOutput(stdout),
                    stderr: this.normalizeOutput(stderr),
                });
            };
            try {
                ksu.exec(cmd, "{}", cb);
            } catch (e) {
                clearTimeout(tm);
                finish({ errno: 127, stdout: '', stderr: String(e) });
            }
        });
    }

    async execOut(cmd, timeoutMs = 8000) {
        const { stdout } = await this.execFull(cmd, timeoutMs);
        return stdout ? stdout.trim() : '';
    }

    async readFile(path, timeoutMs = 8000) {
        const cmd = `/system/bin/cat ${this.shQuote(path)} 2>/dev/null`;
        const { stdout } = await this.execFull(cmd, timeoutMs);
        return stdout || '';
    }

    async writeFile(path, content, timeoutMs = 8000) {
        const b64 = this.b64EncodeUtf8(content);
        const script = 'umask 022; printf %s \"$1\" | /system/bin/base64 -d > \"$2\"';
        const cmd = `/system/bin/sh -c ${this.shQuote(script)} sh ${this.shQuote(b64)} ${this.shQuote(path)}`;
        return await this.execFull(cmd, timeoutMs);
    }

    ltpoText() {
        if (this.ltpoMode === 'disable') return '强制禁用';
        if (this.ltpoMode === 'keep') return '保留(全局不生效)';
        if (this.ltpoMode === 'compat') return '兼容模式';
        return this.ltpoMode || '未知';
    }

    async init() {
        this.loadModuleInfo();
        await this.loadLtpoMode();
        await this.loadDev();
        await this.loadRates();
        await this.loadConf();
        await this.loadApps();
        this.render();
        this.bindEv();
        this.applyModeUi();
    }

    bindEv() {
        document.querySelectorAll('.tab-item').forEach(t => {
            t.addEventListener('click', e => this.page(e.currentTarget.dataset.page));
        });

        document.getElementById('save-global-rate').addEventListener('click', () => this.saveRate());
        document.getElementById('scan-rates').addEventListener('click', () => {
            this.confirm('全量扫描', '此操作会读取系统当前支持的刷新率档位，不会持久修改系统。是否继续？', () => this.scan());
        });
        document.getElementById('save-rates').addEventListener('click', () => this.saveRates());
        document.getElementById('save-app-switch').addEventListener('click', () => this.saveAppSwitch());
        const intv = document.getElementById('app-switch-interval');
        const dec = document.getElementById('app-switch-interval-dec');
        const inc = document.getElementById('app-switch-interval-inc');
        const bump = (delta) => {
            if (!intv) return;
            const min = parseInt(intv.min || '1', 10);
            const max = parseInt(intv.max || '10', 10);
            const cur = parseInt(intv.value || String(min), 10);
            const base = Number.isFinite(cur) ? cur : min;
            const next = Math.max(min, Math.min(max, base + delta));
            intv.value = String(next);
        };
        dec?.addEventListener('click', () => bump(-1));
        inc?.addEventListener('click', () => bump(1));
        document.getElementById('add-app-config').addEventListener('click', () => this.showInput());
        document.getElementById('input-cancel').addEventListener('click', () => this.hideInput());
        document.getElementById('input-done').addEventListener('click', () => this.addApp());
        document.getElementById('coolapk-link').addEventListener('click', () => {
            this.open('http://www.coolapk.com/u/28719807');
        });
        document.getElementById('qq-link').addEventListener('click', () => {
            this.open('https://qun.qq.com/universal-share/share?ac=1&authKey=Jid2j2LBS4R9SXVVRYmB%2FC9xfj3bpNBhttDW2hF1RaqfXmXZFzLUtQADssAMIdMZ&busi_data=eyJncm91cENvZGUiOiI5NzkyMjE4MjIiLCJ0b2tlbiI6IlJNbm96d3JFWWxwM1dxaHRNOWJRcDNLOEpPOUJqU1BwbXFYM3FZRWt3OUdGTzQ2ekNTOVVqa28wQUhwbWlkaEwiLCJ1aW4iOiIzODk0Mzc0NzQxIn0%3D&data=TonB06_M--jrcRTgaBtD3ZfGmxSwWEeuCfTKjic4lriNB78A9ZKcCy8ajlc5w4xfP9g3vX4pqifQf5F2rovHPg&svctype=4&tempid=h5_group_info');
        });
        document.getElementById('donate-wx').addEventListener('click', () => this.showQr('pay/wxpay.png'));
        document.getElementById('donate-ali').addEventListener('click', () => this.showQr('pay/alipay.png'));
        document.getElementById('qr-modal').addEventListener('click', e => {
            if (e.target.id === 'qr-modal') this.hideQr();
        });
        document.getElementById('confirm-cancel').addEventListener('click', () => {
            document.getElementById('confirm-modal').classList.remove('show');
        });
    }

    async loadLtpoMode() {
        try {
            const raw = await this.execOut(`/system/bin/cat ${this.shQuote(`${this.mod}/ltpo_mode`)} 2>/dev/null`);
            this.ltpoMode = raw ? raw.trim() : '';
        } catch (e) {
            this.ltpoMode = '';
        }
    }

    applyModeUi() {
        const saveBtn = document.getElementById('save-global-rate');
        const note = document.getElementById('global-disabled-note');
        if (this.ltpoMode === 'keep') {
            saveBtn?.classList.add('disabled');
            note && (note.style.display = 'block');
        } else {
            saveBtn?.classList.remove('disabled');
            note && (note.style.display = 'none');
        }
        const m = document.getElementById('current-ltpo-mode');
        if (m) m.textContent = this.ltpoText();
    }

    async loadDev() {
        try {
            const m = await this.execOut('/system/bin/getprop ro.product.model');
            let mk = await this.execOut('/system/bin/getprop ro.vendor.oplus.market.name');
            if (!mk) mk = await this.execOut('/system/bin/getprop ro.product.market.name');
            const av = await this.execOut('/system/bin/getprop ro.build.version.release');
            const kv = await this.execOut('/system/bin/uname -r');
            const bl = await this.execOut('/system/bin/cat /sys/class/power_supply/battery/capacity');
            const bt = await this.execOut('/system/bin/cat /sys/class/power_supply/battery/temp');

            document.getElementById('device-model').textContent = m || '未知';
            document.getElementById('market-name').textContent = mk || m || '未知';
            document.getElementById('android-ver').textContent = av ? `Android ${av}` : '未知';
            document.getElementById('kernel-ver').textContent = kv || '未知';
            document.getElementById('battery-level').textContent = bl ? `${bl}%` : '未知';
            document.getElementById('battery-temp').textContent = bt ? `${(parseInt(bt) / 10).toFixed(1)}°C` : '未知';
        } catch (e) {}
    }

    async loadConf() {
        try {
            const c = await this.readFile(`${this.mod}/config.json`);
            if (c) {
                const p = JSON.parse(c);
                if (p.globalRateId !== undefined) this.conf.rateId = p.globalRateId;
                if (p.appSwitchEnabled !== undefined) this.conf.appSw = p.appSwitchEnabled;
                if (p.appSwitchInterval !== undefined) this.conf.appIntv = p.appSwitchInterval;
            }
        } catch (e) {}
    }

    async loadRates() {
        try {
            const c = await this.readFile(`${this.mod}/rates.conf`);
            this.rates = [];
            if (!c) return;
            c.split('\n').forEach(l => {
                if (!l.trim()) return;
                const p = l.split(':');
                if (p.length >= 6) {
                    this.rates.push({
                        id: parseInt(p[0]), w: p[1], h: p[2], fps: parseInt(p[3]),
                        type: p[4], base: p[5] === '1', ord: p[6] ? parseInt(p[6]) : 0
                    });
                }
            });
        } catch (e) {}
    }

    async scan() {
        this.toast('正在扫描档位...');
        const raw = await this.execOut(`/system/bin/dumpsys SurfaceFlinger 2>/dev/null | /system/bin/grep 'id=[0-9]*, hwcId='`, 15000);
        if (!raw) {
            this.toast('扫描失败：未读取到档位信息');
            return;
        }
        const map = new Map();
        raw.split('\n').filter(l => l.trim()).forEach(l => {
            const id = l.match(/id=(\d+),/)?.[1];
            const res = l.match(/resolution=(\d+)x(\d+)/);
            const rate = l.match(/(?:vsyncRate|refreshRate)=([0-9.]+)/)?.[1];
            if (id && res && rate && !map.has(id)) {
                map.set(id, { id: parseInt(id), w: res[1], h: res[2], fps: Math.round(parseFloat(rate)) });
            }
        });
        const arr = Array.from(map.values());
        arr.sort((a, b) => a.fps !== b.fps ? a.fps - b.fps : parseInt(a.w) - parseInt(b.w));
        this.rates = arr.map(r => ({ ...r, type: 'native', base: false, ord: 0 }));
        this.drawSettings();
        this.drawSelector();
        this.toast(`扫描完成，共 ${this.rates.length} 个档位`);
    }

    async saveRates() {
        if (this.rates.some(r => r.type === 'overclock' && (!r.ord || r.ord < 1))) {
            this.toast('请为所有超频档位填写切换顺序(从1开始)');
            return;
        }
        if (!this.rates.some(r => r.base)) {
            this.toast('请至少设置一个原生基准');
            return;
        }
        const lines = this.rates.map(r => `${r.id}:${r.w}:${r.h}:${r.fps}:${r.type}:${r.base ? '1' : '0'}:${r.ord || 0}`);
        const res = await this.writeFile(`${this.mod}/rates.conf`, `${lines.join('\n')}`);
        if (res.errno !== 0) { this.toastErr('保存', res); return; }
        await this.sync();
        this.updInfo();
        this.drawSelector();
        this.toast('档位配置已保存');
    }

    async saveRate() {
        if (this.ltpoMode === 'keep') { this.toast('保留LTPO模式：全局档位不生效'); return; }
        const el = document.querySelector('#rate-selector .rate-item.active');
        if (!el) { this.toast('请选择刷新率'); return; }
        const id = parseInt(el.dataset.id);
        this.conf.rateId = id;
        const obj = { globalRateId: id, appSwitchEnabled: this.conf.appSw, appSwitchInterval: this.conf.appIntv };
        const res = await this.writeFile(`${this.mod}/config.json`, JSON.stringify(obj));
        if (res.errno !== 0) { this.toastErr('保存', res); return; }
        await this.sync();
        const r = this.rates.find(x => x.id === id);
        await this.apply(id);
        this.updInfo();
        this.toast(`已保存: ${r?.fps || id}Hz (ID:${id})`);
    }

    rateOf(id) { return this.rates.find(r => r.id === id) || null; }
    nativeFor(res) {
        const n = this.rates.find(r => `${r.w}x${r.h}` === res && r.base);
        return n ? n.id : 1;
    }

    ocUp(res, to) {
        return this.rates.filter(r => `${r.w}x${r.h}` === res && r.type === 'overclock' && r.ord > 0 && r.ord <= to)
            .sort((a, b) => a.ord - b.ord).map(r => r.id);
    }

    ocDown(res, from) {
        return this.rates.filter(r => `${r.w}x${r.h}` === res && r.type === 'overclock' && r.ord > 0 && r.ord < from)
            .sort((a, b) => b.ord - a.ord).map(r => r.id);
    }

    ocRange(res, from, to) {
        if (from < to) {
            return this.rates.filter(r => `${r.w}x${r.h}` === res && r.type === 'overclock' && r.ord > from && r.ord <= to)
                .sort((a, b) => a.ord - b.ord).map(r => r.id);
        }
        return this.rates.filter(r => `${r.w}x${r.h}` === res && r.type === 'overclock' && r.ord < from && r.ord >= to)
            .sort((a, b) => b.ord - a.ord).map(r => r.id);
    }

    async apply(tid) {
        if (tid === this.curId) return;
        const t = this.rateOf(tid);
        if (!t) {
            await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${tid}`, 8000);
            this.curId = tid;
            return;
        }
        await this.execOut('/system/bin/settings put system peak_refresh_rate 240.0', 8000);
        await this.execOut('/system/bin/settings put system min_refresh_rate 10.0', 8000);

        const tt = t.type, tr = `${t.w}x${t.h}`, to = t.ord || 0;
        const c = this.rateOf(this.curId);
        const ct = c?.type, cr = c ? `${c.w}x${c.h}` : null, co = c?.ord || 0;

        if (!tt || tt === 'native') {
            if (ct === 'overclock' && this.curId) {
                for (const i of this.ocDown(cr, co)) await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${i}`, 8000);
                await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${this.nativeFor(cr)}`, 8000);
            }
            await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${tid}`, 8000);
            this.curId = tid;
            return;
        }

        if (tt === 'overclock') {
            const tn = this.nativeFor(tr);
            if (ct === 'overclock' && cr === tr && this.curId) {
                for (const i of this.ocRange(tr, co, to)) await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${i}`, 8000);
            } else {
                if (ct === 'overclock' && this.curId) {
                    for (const i of this.ocDown(cr, co)) await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${i}`, 8000);
                    await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${this.nativeFor(cr)}`, 8000);
                }
                await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${tn}`, 8000);
                for (const i of this.ocUp(tr, to)) await this.execOut(`/system/bin/service call SurfaceFlinger 1035 i32 ${i}`, 8000);
            }
        }
        this.curId = tid;
    }

    async loadApps() {
        try {
            const c = await this.readFile(`${this.mod}/apps.conf`);
            this.apps = (c || '').split('\n').filter(l => l.includes('=')).map(l => {
                const [p, i] = l.split('=');
                return { pkg: p.trim(), id: i.trim() };
            }).filter(x => x.pkg && x.id);
        } catch (e) {}
    }

    async saveApps() {
        const c = this.apps.map(x => `${x.pkg}=${x.id}`).join('\n');
        const res = await this.writeFile(`${this.mod}/apps.conf`, c);
        if (res.errno !== 0) { this.toastErr('保存', res); return; }
        await this.sync();
    }

    async sync() {
        await this.execOut(`/system/bin/mkdir -p ${this.shQuote(this.pdir)}`, 8000);
        await this.execOut(`/system/bin/cp -af ${this.shQuote(`${this.mod}/config.json`)} ${this.shQuote(`${this.pdir}/config.json`)} 2>/dev/null`, 8000);
        await this.execOut(`/system/bin/cp -af ${this.shQuote(`${this.mod}/apps.conf`)} ${this.shQuote(`${this.pdir}/apps.conf`)} 2>/dev/null`, 8000);
        await this.execOut(`/system/bin/cp -af ${this.shQuote(`${this.mod}/rates.conf`)} ${this.shQuote(`${this.pdir}/rates.conf`)} 2>/dev/null`, 8000);
    }

    render() {
        this.drawSelector();
        this.drawSettings();
        this.drawApps();
        this.drawAppSwitch();
        this.updInfo();
    }

    drawSelector() {
        const el = document.getElementById('rate-selector');
        const note = document.getElementById('rate-note');
        if (!this.rates.length) { el.innerHTML = ''; note.style.display = 'block'; return; }
        note.style.display = 'none';
        el.innerHTML = this.rates.map(r => {
            const typeClass = r.type === 'overclock' ? 'overclock' : '';
            const typeText = r.type === 'overclock' ? '超频' : '原生';
            const active = this.conf.rateId === r.id ? 'active' : '';
            return `
            <div class="rate-item ${active}" data-id="${r.id}">
                <div class="rate-item-left">
                    <span class="rate-label">${this.escapeHtml(r.fps)}Hz</span>
                    <span class="rate-type-tag ${typeClass}">${typeText}</span>
                </div>
                <span class="rate-id">${this.escapeHtml(r.w)}x${this.escapeHtml(r.h)} (ID:${this.escapeHtml(r.id)})</span>
            </div>
        `}).join('');
        if (this.ltpoMode === 'keep') return;
        el.querySelectorAll('.rate-item').forEach(x => {
            x.addEventListener('click', e => {
                el.querySelectorAll('.rate-item').forEach(y => y.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });
    }

    drawSettings() {
        const el = document.getElementById('rate-settings-list');
        if (!this.rates.length) {
            el.innerHTML = '<div style="text-align:center;padding:20px;color:#8E8E93">请先执行全量扫描</div>';
            return;
        }
        el.innerHTML = this.rates.map((r, i) => `
            <div class="rate-setting-item ${r.base ? 'is-base' : ''}" data-idx="${i}">
                <div class="rate-setting-header">
                    <div class="rate-setting-info">
                        <span class="rate-setting-fps">${r.fps}Hz</span>
                        ${r.base ? '<span class="rate-setting-badge">基准</span>' : ''}
                    </div>
                    <div class="rate-setting-types">
                        <span class="type-btn native ${r.type === 'native' ? 'active' : ''}" data-idx="${i}" data-type="native">原生</span>
                        <span class="type-btn overclock ${r.type === 'overclock' ? 'active' : ''}" data-idx="${i}" data-type="overclock">超频</span>
                    </div>
                </div>
                <div class="rate-setting-meta">${r.w}x${r.h} · ID:${r.id}</div>
                <div class="rate-setting-action">
                    <div class="base-btn ${r.base ? 'is-base' : ''}" data-idx="${i}">
                        ${r.base ? '✓ 已设为该分辨率的原生基准' : '设为该分辨率的原生基准'}
                    </div>
                </div>
                ${r.type === 'overclock' ? `
                    <div class="order-input-row">
                        <span class="order-label">切换顺序 <span class="required">*必填</span>:</span>
                        <input type="number" class="order-input" data-idx="${i}" value="${r.ord || ''}" placeholder="必填">
                    </div>
                ` : ''}
            </div>
        `).join('');

        el.querySelectorAll('.type-btn').forEach(b => {
            b.addEventListener('click', e => {
                const i = parseInt(e.target.dataset.idx), t = e.target.dataset.type;
                this.rates[i].type = t;
                if (t === 'native') this.rates[i].ord = 0;
                this.drawSettings();
            });
        });
        el.querySelectorAll('.base-btn').forEach(b => {
            b.addEventListener('click', e => {
                const i = parseInt(e.target.dataset.idx), r = this.rates[i], res = `${r.w}x${r.h}`;
                this.rates.forEach(x => { if (`${x.w}x${x.h}` === res) x.base = false; });
                this.rates[i].base = true;
                this.rates[i].type = 'native';
                this.rates[i].ord = 0;
                this.drawSettings();
            });
        });
        el.querySelectorAll('.order-input').forEach(inp => {
            inp.addEventListener('change', e => {
                this.rates[parseInt(e.target.dataset.idx)].ord = parseInt(e.target.value) || 0;
            });
        });
    }

    drawApps() {
        const el = document.getElementById('app-config-list');
        if (!this.apps.length) {
            el.innerHTML = '<div style="text-align:center;padding:20px;color:#8E8E93">暂无配置</div>';
            return;
        }
        el.innerHTML = this.apps.map((a, i) => `
            <div class="config-item">
                <span class="config-pkg">${this.escapeHtml(a.pkg)}</span>
                <span class="config-id">ID: ${this.escapeHtml(a.id)}</span>
                <span class="config-delete" data-idx="${i}">删除</span>
            </div>
        `).join('');
        el.querySelectorAll('.config-delete').forEach(x => {
            x.addEventListener('click', async e => {
                this.apps.splice(parseInt(e.target.dataset.idx), 1);
                await this.saveApps();
                this.drawApps();
                this.toast('已删除');
            });
        });
    }

    updInfo() {
        const gid = document.getElementById('current-global-id');
        const nbase = document.getElementById('current-native-base');
        gid.textContent = (this.ltpoMode === 'keep') ? '不生效(保留LTPO)' : (this.conf.rateId || '未设置');
        const bs = this.rates.filter(r => r.base);
        nbase.textContent = bs.length ? bs.map(b => `${b.w}x${b.h}→ID:${b.id}`).join(', ') : '未设置';
    }

    drawAppSwitch() {
        const sw = document.getElementById('app-switch-enabled');
        const it = document.getElementById('app-switch-interval');
        if (sw) sw.checked = !!this.conf.appSw;
        if (it) it.value = String(this.conf.appIntv || 1);
    }

    async saveAppSwitch() {
        const sw = document.getElementById('app-switch-enabled');
        const it = document.getElementById('app-switch-interval');
        const enabled = !!sw?.checked;
        const interval = parseInt(it?.value || '1', 10);
        if (!Number.isFinite(interval) || interval < 1) { this.toast('轮询间隔至少为1秒'); return; }
        this.conf.appSw = enabled;
        this.conf.appIntv = interval;
        const obj = { globalRateId: this.conf.rateId, appSwitchEnabled: this.conf.appSw, appSwitchInterval: this.conf.appIntv };
        const res = await this.writeFile(`${this.mod}/config.json`, JSON.stringify(obj));
        if (res.errno !== 0) { this.toastErr('保存', res); return; }
        await this.sync();
        this.toast('应用切换设置已保存');
    }

    page(p) {
        document.querySelectorAll('.ui-content').forEach(x => x.classList.add('hidden'));
        const t = document.getElementById(`page-${p}`);
        t.classList.remove('hidden');
        t.style.justifyContent = (p === 'home' || p === 'settings' || p === 'apps') ? 'flex-start' : 'center';
        document.querySelectorAll('.tab-item').forEach(x => x.classList.remove('active'));
        document.querySelector(`.tab-item[data-page="${p}"]`).classList.add('active');
    }

    showInput() {
        document.getElementById('app-input-modal').classList.add('show');
        document.getElementById('app-package').value = '';
        document.getElementById('app-rate-id').value = '';
    }

    hideInput() { document.getElementById('app-input-modal').classList.remove('show'); }

    async addApp() {
        const pkg = document.getElementById('app-package').value.trim();
        const id = document.getElementById('app-rate-id').value.trim();
        if (!pkg || !id) { this.toast('请填写完整信息'); return; }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(pkg)) { this.toast('包名格式不正确'); return; }
        if (!/^[0-9]+$/.test(id)) { this.toast('刷新率ID必须为数字'); return; }
        const idx = this.apps.findIndex(x => x.pkg === pkg);
        if (idx >= 0) this.apps[idx].id = id;
        else this.apps.push({ pkg, id });
        await this.saveApps();
        this.drawApps();
        this.hideInput();
        this.toast('配置已添加');
    }

    confirm(title, msg, cb) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = msg;
        document.getElementById('confirm-modal').classList.add('show');
        const ok = document.getElementById('confirm-ok');
        const nok = ok.cloneNode(true);
        ok.parentNode.replaceChild(nok, ok);
        nok.addEventListener('click', () => {
            document.getElementById('confirm-modal').classList.remove('show');
            cb();
        });
    }

    async open(url) { await this.execOut(`/system/bin/am start -a android.intent.action.VIEW -d ${this.shQuote(url)}`, 8000); }

    showQr(src) {
        const m = document.getElementById('qr-modal');
        const img = document.getElementById('qr-image');
        img.onerror = () => {
            img.onerror = null;
            this.hideQr();
            this.toast('二维码资源缺失');
        };
        img.src = src;
        m.classList.remove('hidden');
        setTimeout(() => m.classList.add('show'), 10);
    }

    hideQr() {
        const m = document.getElementById('qr-modal');
        m.classList.remove('show');
        setTimeout(() => m.classList.add('hidden'), 300);
    }

    toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }
}

document.addEventListener('DOMContentLoaded', () => new StellarEngine());
