'use strict';

// --- 換算係数（医学的根拠） ---
const SALT_G_TO_NA_MEQ = 17;   // NaCl 1 g ≈ 17 mEq Na (58.5 g/mol)
const K_G_TO_MEQ = 25.6;       // K 1 g ≈ 25.6 mEq (39.1 g/mol)
const HOURS = 24;

// --- DOM ---
const $ = (id) => document.getElementById(id);
const infusionList = $('infusion-list');
const weightInput = $('weight');
const metabolicWaterInput = $('metabolicWater');
const insensibleLossInput = $('insensibleLoss');
const manualMetabolicCheckbox = $('manualMetabolic');
const manualInsensibleCheckbox = $('manualInsensible');

let resultShown = false; // 初回計算後は入力変更で自動再計算する

const getVal = (id) => parseFloat($(id).value) || 0;

// --- 自動計算（体重ベースの初期値） ---
function updateAutoCalculations() {
    const weight = parseFloat(weightInput.value) || 0;
    if (!manualMetabolicCheckbox.checked) {
        metabolicWaterInput.value = (weight * 5).toFixed(0);          // 代謝水 5 mL/kg/day
    }
    if (!manualInsensibleCheckbox.checked) {
        insensibleLossInput.value = ((weight * 15) / 24).toFixed(1);  // 不感蒸泄 15 mL/kg/day
    }
}

manualMetabolicCheckbox.addEventListener('change', function () {
    metabolicWaterInput.disabled = !this.checked;
    if (!this.checked) updateAutoCalculations();
});
manualInsensibleCheckbox.addEventListener('change', function () {
    insensibleLossInput.disabled = !this.checked;
    if (!this.checked) updateAutoCalculations();
});
weightInput.addEventListener('input', updateAutoCalculations);

// --- 輸液の追加 / 削除 ---
$('add-infusion-btn').addEventListener('click', () => {
    const count = infusionList.getElementsByClassName('infusion-item').length;
    const item = document.createElement('div');
    item.className = 'infusion-item';
    item.innerHTML = `
        <div class="infusion-item__title">輸液 ${count + 1}</div>
        <div class="field"><label>Na濃度 (mEq/L)</label><input type="number" class="infusionNa" value="0" step="1" inputmode="decimal"></div>
        <div class="field"><label>K濃度 (mEq/L)</label><input type="number" class="infusionK" value="0" step="1" inputmode="decimal"></div>
        <div class="field"><label>1日の投与量 (mL/日)</label><input type="number" class="infusionVolumeDay" value="0" step="50" inputmode="decimal"></div>
        <div class="infusion-item__actions"><button type="button" class="btn-remove remove-infusion-btn">− 削除</button></div>
    `;
    infusionList.appendChild(item);
});

infusionList.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('remove-infusion-btn')) {
        e.target.closest('.infusion-item').remove();
        Array.from(infusionList.getElementsByClassName('infusion-item')).forEach((item, i) => {
            item.querySelector('.infusion-item__title').textContent = `輸液 ${i + 1}`;
        });
        if (resultShown) calculate();
    }
});

// --- バリデーション ---
function validate(weight, coef, currentNa) {
    const warnings = [];
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

    if (weight <= 0) { $('weight').classList.add('invalid'); warnings.push('体重を正の値で入力してください。'); }
    if (coef <= 0) warnings.push('体液量係数が不正です。');
    if (currentNa < 100 || currentNa > 160) { $('currentNa').classList.add('invalid'); warnings.push('現在のNa値が通常域外です（入力をご確認ください）。'); }

    const intake = getVal('intakePercent');
    if (intake < 0 || intake > 100) { $('intakePercent').classList.add('invalid'); warnings.push('食事摂取率は0〜100%で入力してください。'); }

    ['dietSalt', 'oralNaCl', 'dietK', 'dietWater', 'drinkWater', 'urineVolume', 'insensibleLoss', 'metabolicWater'].forEach(id => {
        if (getVal(id) < 0) { $(id).classList.add('invalid'); warnings.push('負の値が入力されています。'); }
    });
    return warnings;
}

// --- メイン計算 ---
function calculate() {
    resultShown = true;
    document.querySelector('.actions').classList.add('computed');

    const currentNa = getVal('currentNa');
    const weight = getVal('weight');
    const coef = getVal('coefficient');

    const inputWarnings = validate(weight, coef, currentNa);
    if (weight <= 0 || coef <= 0) {
        showResult(null, inputWarnings.join(' '));
        return;
    }

    const intake = getVal('intakePercent') / 100;

    // 1時間あたりのフロー（予測期間中は一定と仮定）
    let infNaMeqDay = 0, infKMeqDay = 0, infWaterMlDay = 0;
    document.querySelectorAll('.infusion-item').forEach(item => {
        const na = parseFloat(item.querySelector('.infusionNa').value) || 0;
        const k = parseFloat(item.querySelector('.infusionK').value) || 0;
        const vol = parseFloat(item.querySelector('.infusionVolumeDay').value) || 0;
        infNaMeqDay += na * vol / 1000;
        infKMeqDay += k * vol / 1000;
        infWaterMlDay += vol;
    });

    const dietNaMeqDay = getVal('dietSalt') * SALT_G_TO_NA_MEQ * intake;
    const oralNaMeqDay = getVal('oralNaCl') * SALT_G_TO_NA_MEQ;   // 内服=薬剤、摂取率は乗じない
    const dietKMeqDay = getVal('dietK') * K_G_TO_MEQ * intake;
    const dietWaterMlDay = getVal('dietWater') * intake;

    const naKInPerHr = (dietNaMeqDay + oralNaMeqDay + dietKMeqDay + infNaMeqDay + infKMeqDay) / HOURS;          // mEq/hr
    const waterInPerHr = (dietWaterMlDay + getVal('drinkWater') + getVal('metabolicWater') + infWaterMlDay) / 1000 / HOURS; // L/hr

    const urineNaK = getVal('urineNa') + getVal('urineK');
    const naKOutPerHr = urineNaK * getVal('urineVolume') / 1000;        // mEq/hr
    const waterOutPerHr = (getVal('urineVolume') + getVal('insensibleLoss')) / 1000; // L/hr

    // Euler積分（1時間ステップ × 24）: Edelman式 [Na] = (総Na+総K)/TBW を逐次更新
    const tbw0 = weight * coef;
    let totalNaK = currentNa * tbw0;
    let totalWater = tbw0;
    const series = [currentNa];
    let invalid = false;
    for (let h = 1; h <= HOURS; h++) {
        totalNaK += naKInPerHr - naKOutPerHr;
        totalWater += waterInPerHr - waterOutPerHr;
        if (totalWater <= 0.1) { invalid = true; break; }
        series.push(totalNaK / totalWater);
    }
    if (invalid || !series.every(Number.isFinite)) {
        showResult(null, '水分OUTが過大で体液量が枯渇する計算になりました。入力（尿量・不感蒸泄）をご確認ください。');
        return;
    }

    const naChangeFirstHour = series[1] - series[0];
    const predictedNa24 = series[HOURS];
    const naChange24 = predictedNa24 - currentNa;

    showResult({
        series, currentNa, naChangeFirstHour, predictedNa24, naChange24,
        flows: { naKInPerHr, waterInPerHr, naKOutPerHr, waterOutPerHr, tbw0, totalNaK, totalWater,
                 dietNaMeqDay, oralNaMeqDay, dietKMeqDay, infNaMeqDay, infKMeqDay }
    }, inputWarnings.join(' '));
}

$('calculate-btn').addEventListener('click', calculate);

// 初回計算後は、入力（数値・選択・チェック）の変更で自動再計算
function autoRecalc() { if (resultShown) calculate(); }
document.addEventListener('input', autoRecalc);
document.addEventListener('change', autoRecalc);

// --- 結果表示 ---
function showResult(r, warnText) {
    $('result-section').hidden = false;
    if (!r) {
        setAlert('danger', '計算できません', warnText || '入力をご確認ください。');
        $('predictedNaNextHour').textContent = '– mEq/L';
        $('naChangeFirstHour').textContent = '– mEq/hr';
        $('predictedNa24Hours').textContent = '– mEq/L';
        $('naChange24h').textContent = '– mEq/L';
        $('chart-host').innerHTML = '';
        $('formula-content').innerHTML = '';
        return;
    }

    $('predictedNaNextHour').textContent = `${r.series[1].toFixed(1)} mEq/L`;
    $('naChangeFirstHour').textContent = `${fmtSigned(r.naChangeFirstHour, 2)} mEq/hr`;
    $('predictedNa24Hours').textContent = `${r.predictedNa24.toFixed(1)} mEq/L`;
    $('naChange24h').textContent = `${fmtSigned(r.naChange24, 1)} mEq/L`;

    const highRisk = ['riskNa105', 'riskHypoK', 'riskAlcohol', 'riskLiver'].some(id => $(id).checked);
    const limit = highRisk ? 6 : 8;
    const severe = highRisk ? 8 : 10;
    const targetText = `目標補正幅: ≤${limit} mEq/L/24h${highRisk ? '（高リスク該当）' : '（標準）'}、下限の目安 4〜6 mEq/L`;
    const c = r.naChange24;

    if (c > severe) {
        setAlert('danger', `過補正の危険域：24時間で ${fmtSigned(c, 1)} mEq/L（危険 >${severe}）`, `${targetText}。補正速度の減速、自由水負荷やDDAVPの併用を検討。`);
    } else if (c > limit) {
        setAlert('warning', `目標上限を超過：24時間で ${fmtSigned(c, 1)} mEq/L（目標 ≤${limit}）`, `${targetText}。補正速度の見直しを。`);
    } else if (c < -0.5) {
        setAlert('caution', `Naが低下する予測：24時間で ${fmtSigned(c, 1)} mEq/L`, '低Na血症が増悪する方向です。輸液組成・水分制限の見直しを。');
    } else if (c < 1) {
        setAlert('caution', `ほとんど補正されない予測：24時間で ${fmtSigned(c, 1)} mEq/L`, `${targetText}。`);
    } else {
        setAlert('safe', `目標範囲内：24時間で ${fmtSigned(c, 1)} mEq/L`, `${targetText}。`);
    }

    drawChart($('chart-host'), r.series, r.currentNa, limit, severe);
    renderFormula(r);
}

function setAlert(kind, title, sub) {
    const box = $('alert-box');
    box.className = 'alert alert--' + kind;
    $('alert-text').textContent = title;
    $('alert-sub').textContent = sub || '';
}

function fmtSigned(v, digits) {
    return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

// --- SVG折れ線グラフ（CDN不使用） ---
function drawChart(host, series, na0, limit, severe) {
    const W = 720, H = 320, padL = 48, padR = 16, padT = 16, padB = 32;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const dataMin = Math.min(...series), dataMax = Math.max(...series);
    let yMin = Math.min(na0 - 1, dataMin - 0.5);
    let yMax = Math.max(na0 + severe + 1, dataMax + 0.5);
    if (yMax - yMin < 4) yMax = yMin + 4;

    const x = (h) => padL + (h / HOURS) * plotW;
    const y = (v) => padT + (yMax - v) / (yMax - yMin) * plotH;

    const band = (vTop, vBot, fill) => {
        const yt = Math.max(padT, y(vTop));
        const yb = Math.min(padT + plotH, y(vBot));
        if (yb <= yt) return '';
        return `<rect x="${padL}" y="${yt.toFixed(1)}" width="${plotW}" height="${(yb - yt).toFixed(1)}" fill="${fill}"/>`;
    };

    const bands =
        band(na0 + limit, na0, '#dcfce7') +          // green: 目標域
        band(na0 + severe, na0 + limit, '#fef3c7') + // amber: 上限超
        band(yMax, na0 + severe, '#fee2e2');         // red: 危険域

    // y目盛り
    let yTicks = '';
    const step = niceStep((yMax - yMin) / 5);
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
        const yy = y(v).toFixed(1);
        yTicks += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`
            + `<text x="${padL - 6}" y="${(+yy + 4)}" text-anchor="end" font-size="11" fill="#6b7280">${v.toFixed(0)}</text>`;
    }
    // x目盛り
    let xTicks = '';
    for (let h = 0; h <= HOURS; h += 6) {
        const xx = x(h).toFixed(1);
        xTicks += `<text x="${xx}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="#6b7280">${h}h</text>`;
    }

    const baseline = `<line x1="${padL}" y1="${y(na0).toFixed(1)}" x2="${W - padR}" y2="${y(na0).toFixed(1)}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4 3"/>`;

    const pts = series.map((v, h) => `${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const line = `<polyline points="${pts}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round"/>`;
    const dots = series.map((v, h) => `<circle cx="${x(h).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="#4f46e5"/>`).join('');

    const axis = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#9ca3af"/>`
        + `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#9ca3af"/>`;

    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="血清Naの24時間推移">`
        + bands + yTicks + xTicks + baseline + axis + line + dots
        + `<text x="${padL}" y="12" font-size="11" fill="#6b7280">Na (mEq/L)</text>`
        + `</svg>`;
}

function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
}

// --- 計算式の詳細 ---
function renderFormula(r) {
    const f = r.flows;
    $('formula-content').innerHTML = `
        <div class="formula-block">
            <p class="head">モデル：Edelman式の逐次計算（1時間ステップ × 24）</p>
            <p>[Na] = (総Na + 総K) ÷ TBW を毎時更新</p>
            <p>初期 TBW = 体重 × 係数 = ${f.tbw0.toFixed(2)} L</p>
            <p>初期 総Na+K = 現在Na × TBW = ${(r.currentNa * f.tbw0).toFixed(1)} mEq</p>
        </div>
        <div class="formula-block">
            <p class="head">1時間あたりの流入（IN）</p>
            <p>Na+K IN = ${f.naKInPerHr.toFixed(3)} mEq/hr</p>
            <p>内訳：食事Na ${(f.dietNaMeqDay/24).toFixed(3)}、内服NaCl ${(f.oralNaMeqDay/24).toFixed(3)}、食事K ${(f.dietKMeqDay/24).toFixed(3)}、輸液Na ${(f.infNaMeqDay/24).toFixed(3)}、輸液K ${(f.infKMeqDay/24).toFixed(3)}（mEq/hr）</p>
            <p>水分 IN = ${(f.waterInPerHr * 1000).toFixed(1)} mL/hr</p>
        </div>
        <div class="formula-block">
            <p class="head">1時間あたりの排出（OUT）</p>
            <p>Na+K OUT = ${f.naKOutPerHr.toFixed(3)} mEq/hr（尿）</p>
            <p>水分 OUT = ${(f.waterOutPerHr * 1000).toFixed(1)} mL/hr（尿 + 不感蒸泄）</p>
        </div>
        <div class="formula-block">
            <p class="head">24時間後</p>
            <p>総Na+K = ${f.totalNaK.toFixed(1)} mEq、総水分 = ${f.totalWater.toFixed(2)} L</p>
            <p>予測Na = ${r.predictedNa24.toFixed(1)} mEq/L</p>
        </div>
    `;
}

// 初期化
updateAutoCalculations();
