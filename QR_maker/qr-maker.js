(() => {
  'use strict';

  const form = document.querySelector('#qr-form');
  const modeSelect = document.querySelector('#qr-mode');
  const panels = [...document.querySelectorAll('[data-mode-panel]')];
  const output = document.querySelector('#qr-canvas');
  const placeholder = document.querySelector('#qr-placeholder');
  const download = document.querySelector('#qr-download');
  const status = document.querySelector('#qr-status');
  const payloadView = document.querySelector('#qr-payload');
  const bankSelect = document.querySelector('#pay-bank');
  const customBank = document.querySelector('#pay-bank-custom');
  const countrySelect = document.querySelector('#sms-country');
  const customCountry = document.querySelector('#sms-custom-country');

  function setMode() {
    const active = modeSelect.value;
    for (const panel of panels) {
      const enabled = panel.dataset.modePanel === active;
      panel.hidden = !enabled;
      panel.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = !enabled; });
    }
  }

  function updateConditionalFields() {
    customBank.hidden = bankSelect.value !== 'other';
    customBank.disabled = bankSelect.value !== 'other' || modeSelect.value !== 'payment';
    customCountry.hidden = countrySelect.value !== 'custom';
    customCountry.disabled = countrySelect.value !== 'custom' || modeSelect.value !== 'sms';
  }

  function fail(message, field) {
    status.textContent = message;
    if (field) field.focus();
    throw new Error(message);
  }

  // Keep qrcode.js away from raw control bytes and malformed UTF-16 surrogates.
  // Controls are represented visibly as ASCII escapes so scanners retain readable data.
  function makeQrSafe(value) {
    let safe = '';
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          safe += value[index] + value[index + 1];
          index++;
        } else {
          safe += '\ufffd';
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        safe += '\ufffd';
      } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
        safe += `\\x${code.toString(16).padStart(2, '0')}`;
      } else {
        safe += value[index];
      }
    }
    return safe;
  }

  function encodeMailValue(value) {
    // RFC 6068 mailto fields use percent encoding, so spaces remain %20.
    return encodeURIComponent(value);
  }

  function createCzechIban(accountInput, bankCode) {
    const account = accountInput.trim().replaceAll(' ', '');
    const match = account.match(/^(?:(\d{1,6})-)?(\d{1,10})$/);
    if (!match) fail('Zadej účet jako číslo nebo předčíslí-číslo (nejvýše 6 a 10 číslic).', document.querySelector('#pay-account'));
    if (!/^\d{4}$/.test(bankCode)) fail('Kód banky musí mít přesně čtyři číslice.', customBank);
    const prefix = (match[1] || '').padStart(6, '0');
    const number = match[2].padStart(10, '0');
    const bban = `${bankCode}${prefix}${number}`;
    const rearranged = `${bban}123500`;
    let remainder = 0;
    for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
    const checkDigits = String(98 - remainder).padStart(2, '0');
    return `CZ${checkDigits}${bban}`;
  }

  // SPAYD values use URL encoding for characters outside the compact QR alphabet.
  // In particular, '*' must be escaped because it separates the fields.
  function encodeSpaydValue(value) {
    const allowed = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $+-./:');
    return [...new TextEncoder().encode(value)].map(byte => {
      const char = String.fromCharCode(byte);
      return byte < 128 && allowed.has(char) ? char : `%${byte.toString(16).padStart(2, '0').toUpperCase()}`;
    }).join('');
  }

  function buildPayload() {
    switch (modeSelect.value) {
      case 'url': {
        let value = document.querySelector('#url-value').value.trim();
        if (!value) fail('Zadej webovou adresu.', document.querySelector('#url-value'));
        if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
        let parsed;
        try { parsed = new URL(value); } catch { fail('Tato webová adresa není platná.', document.querySelector('#url-value')); }
        if (!['http:', 'https:'].includes(parsed.protocol)) fail('Odkaz musí začínat http:// nebo https://.', document.querySelector('#url-value'));
        return parsed.href;
      }
      case 'email': {
        const address = document.querySelector('#email-address').value.trim();
        if (!address) fail('Zadej e-mailovou adresu.', document.querySelector('#email-address'));
        const subject = document.querySelector('#email-subject').value.trim();
        const body = document.querySelector('#email-body').value;
        const params = [];
        if (subject) params.push(`subject=${encodeMailValue(subject)}`);
        if (body) params.push(`body=${encodeMailValue(body)}`);
        return `mailto:${address}${params.length ? `?${params.join('&')}` : ''}`;
      }
      case 'sms': {
        let prefix = countrySelect.value === 'custom' ? customCountry.value.trim() : countrySelect.value;
        if (!/^\+\d{1,4}$/.test(prefix)) fail('Zadej předvolbu ve formátu +420.', customCountry);
        const phone = document.querySelector('#sms-phone').value.replace(/[\s()-]/g, '');
        if (!/^\d{3,15}$/.test(phone)) fail('Telefonní číslo zadej jako 3 až 15 číslic.', document.querySelector('#sms-phone'));
        const text = document.querySelector('#sms-body').value;
        return `sms:${prefix}${phone}${text ? `?body=${encodeURIComponent(text)}` : ''}`;
      }
      case 'text': {
        const value = document.querySelector('#plain-text').value;
        if (!value.trim()) fail('Zadej text, který chceš do QR kódu uložit.', document.querySelector('#plain-text'));
        return makeQrSafe(value);
      }
      case 'payment': {
        const bankCode = bankSelect.value === 'other' ? customBank.value.trim() : bankSelect.value;
        const iban = createCzechIban(document.querySelector('#pay-account').value, bankCode);
        const amountField = document.querySelector('#pay-amount');
        const amount = Number(amountField.value);
        if (!Number.isFinite(amount) || amount < 0.01 || amount > 9999999.99 || Math.round(amount * 100) !== amount * 100) {
          fail('Částka musí být od 0,01 do 9 999 999,99 Kč a nejvýše na dvě desetinná místa.', amountField);
        }
        const messageField = document.querySelector('#pay-message');
        const recipientField = document.querySelector('#pay-recipient');
        const message = messageField.value.trim();
        const recipient = recipientField.value.trim();
        const vs = document.querySelector('#pay-vs').value.trim();
        if ([...message].length > 60) fail('Zpráva pro příjemce může mít nejvýše 60 znaků.', messageField);
        if ([...recipient].length > 35) fail('Jméno příjemce může mít nejvýše 35 znaků.', recipientField);
        if (vs && !/^\d{1,10}$/.test(vs)) fail('Variabilní symbol může mít nejvýše 10 číslic.', document.querySelector('#pay-vs'));
        // QR Platba / SPAYD: required account plus explicit CZK amount and currency.
        // Keep ACC, AM, CC, MSG, RN and X-VS in the requested interoperable order.
        const fields = [`ACC:${iban}`, `AM:${amount.toFixed(2)}`, 'CC:CZK'];
        if (message) fields.push(`MSG:${encodeSpaydValue(message)}`);
        if (recipient) fields.push(`RN:${encodeSpaydValue(recipient)}`);
        if (vs) fields.push(`X-VS:${vs}`);
        return `SPD*1.0*${fields.join('*')}`;
      }
      default:
        fail('Vybraný typ QR kódu není podporován.');
    }
  }

  function renderQr(value) {
    if (!window.QRCode) fail('Knihovnu pro QR kódy se nepodařilo načíst. Obnov stránku a zkus to znovu.');
    value = makeQrSafe(value);
    output.replaceChildren();
    download.hidden = true;
    placeholder.hidden = true;
    try {
      new QRCode(output, {
        text: value,
        width: 280,
        height: 280,
        colorDark: '#101820',
        colorLight: '#ffffff',
        // M is the QR Platba recommendation; L leaves more room for long ordinary text.
        correctLevel: modeSelect.value === 'payment' ? QRCode.CorrectLevel.M : QRCode.CorrectLevel.L,
      });
    } catch (error) {
      output.replaceChildren();
      placeholder.hidden = false;
      payloadView.textContent = 'Zatím žádný kód.';
      if (/too long data/i.test(error.message || '')) {
        fail('Text je pro jeden QR kód příliš dlouhý. Zkrať ho a zkus generování znovu.');
      }
      fail(`QR kód se nepodařilo vytvořit: ${error.message || 'neznámá chyba knihovny'}`);
    }
    const canvas = output.querySelector('canvas');
    const image = output.querySelector('img');
    const imageUrl = canvas?.toDataURL('image/png') || image?.src;
    if (!imageUrl) fail('QR obrázek se nepodařilo připravit ke stažení.');
    download.href = imageUrl;
    download.download = `qr-${modeSelect.value}.png`;
    download.hidden = false;
    payloadView.textContent = value;
    status.textContent = 'QR kód je připraven. Generování proběhlo lokálně.';
  }

  modeSelect.addEventListener('change', () => { setMode(); updateConditionalFields(); });
  bankSelect.addEventListener('change', updateConditionalFields);
  countrySelect.addEventListener('change', updateConditionalFields);
  form.addEventListener('submit', event => {
    event.preventDefault();
    status.textContent = '';
    try { renderQr(buildPayload()); }
    catch (error) { if (!status.textContent) status.textContent = error.message || 'QR kód se nepodařilo vytvořit.'; }
  });

  const themeKey = 'pixel-desk-theme-v1';
  const themeButton = document.querySelector('#theme-toggle');
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    document.querySelector('#theme-label').textContent = dark ? 'Světlý režim' : 'Tmavý režim';
    document.querySelector('#theme-icon').textContent = dark ? '☼' : '◐';
    themeButton.setAttribute('aria-label', dark ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#141b29' : '#e9edf2';
  }
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  setTheme(theme);
  themeButton.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch { /* The current page still changes theme. */ }
  });

  setMode();
  updateConditionalFields();
})();

