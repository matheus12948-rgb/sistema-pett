// Comprehensive Visual & Functional Audit Automation for PetManager (Etapa 3)
const tempDir = await Deno.makeTempDir();
const chromeProcess = new Deno.Command("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", {
  args: [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${tempDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank"
  ]
}).spawn();

// Wait for CDP endpoint
let targets = null;
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch("http://127.0.0.1:9222/json");
    targets = await res.json();
    if (targets && targets.length > 0) break;
  } catch (_e) {
    await new Promise(r => setTimeout(r, 200));
  }
}

const target = targets.find(t => t.type === "page") || targets[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let msgId = 1;
const consoleLogs = [];
const consoleErrors = [];

ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.method === "Runtime.consoleAPICalled") {
    consoleLogs.push(data.params);
    if (data.params.type === "error") {
      consoleErrors.push(data.params);
    }
  }
  if (data.method === "Runtime.exceptionThrown") {
    consoleErrors.push(data.params);
  }
};

function send(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve) => {
    const handler = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.id === id) {
        ws.removeEventListener("message", handler);
        resolve(data.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");

async function setViewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768
  });
}

async function evalInPage(expr) {
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return res && res.result ? res.result.value : null;
}

async function saveScreenshot(filename) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  await Deno.mkdir("./screenshots", { recursive: true });
  await Deno.writeFile(`./screenshots/${filename}`, Uint8Array.from(atob(res.data), c => c.charCodeAt(0)));
  console.log(`Saved screenshot: ${filename}`);
}

// 1. Navigate to application
await send("Page.navigate", { url: "http://localhost:3000/preview" });
await new Promise(r => setTimeout(r, 1500));

// Set Desktop Viewport
await setViewport(1440, 900);
await new Promise(r => setTimeout(r, 500));

const viewsToTest = [
  'dashboard',
  'clientes',
  'pets',
  'agenda',
  'banho-tosa',
  'produtos',
  'estoque',
  'pdv',
  'financeiro',
  'profissionais',
  'comissoes',
  'fornecedores',
  'relatorios',
  'configuracoes'
];

console.log("=== Testing 14 Views on Desktop (1440x900) ===");
for (const v of viewsToTest) {
  await evalInPage(`App.navigate('${v}')`);
  await new Promise(r => setTimeout(r, 600));
  await saveScreenshot(`view_${v}_desktop.png`);
}

console.log("=== Testing Modals ===");
const modals = [
  'modal-financial-entry',
  'modal-new-product',
  'modal-inventory-movement',
  'modal-new-professional',
  'modal-new-supplier',
  'modal-new-appointment',
  'modal-new-pet',
  'modal-new-client'
];

for (const m of modals) {
  await evalInPage(`App.openModal('${m}')`);
  await new Promise(r => setTimeout(r, 400));
  await saveScreenshot(`modal_${m}.png`);
  // Test closing
  await evalInPage(`App.closeModal('${m}')`);
  await new Promise(r => setTimeout(r, 200));
}

console.log("=== Testing Financial Modal Toggle ===");
await evalInPage(`App.openFinancialModal('Despesa')`);
await new Promise(r => setTimeout(r, 400));
await saveScreenshot(`modal_financial_despesa.png`);
await evalInPage(`App.closeAllModals()`);

console.log("=== Testing Modal Dismissal (ESC & Overlay Click) ===");
await evalInPage(`App.openModal('modal-new-client')`);
await new Promise(r => setTimeout(r, 300));
await evalInPage(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await new Promise(r => setTimeout(r, 300));
const closedByEsc = await evalInPage(`!document.getElementById('modal-new-client').classList.contains('active')`);
console.log("Modal closed by ESC:", closedByEsc);

await evalInPage(`App.openModal('modal-new-client')`);
await new Promise(r => setTimeout(r, 300));
await evalInPage(`document.getElementById('modal-new-client').click()`);
await new Promise(r => setTimeout(r, 300));
const closedByOverlay = await evalInPage(`!document.getElementById('modal-new-client').classList.contains('active')`);
console.log("Modal closed by Overlay click:", closedByOverlay);

console.log("=== Testing Form Submissions & Data Insertion ===");
// 1. Submit Product
await evalInPage(`App.openModal('modal-new-product')`);
await evalInPage(`(() => {
  const form = document.querySelector('#modal-new-product form');
  form.prodName.value = 'Ração Filhotes Premium 15kg';
  form.prodBrand.value = 'NutriPet';
  form.prodCategory.value = 'Alimentação';
  form.prodPrice.value = '189.90';
  form.prodCost.value = '110.00';
  form.prodStock.value = '14';
  form.prodMinStock.value = '5';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
await new Promise(r => setTimeout(r, 400));
const prodSaved = await evalInPage(`PetDatabase.products.some(p => p.name === 'Ração Filhotes Premium 15kg')`);
console.log("Product saved successfully:", prodSaved);

// 2. Submit Financial Entry
await evalInPage(`App.openFinancialModal('Receita')`);
await evalInPage(`(() => {
  const form = document.querySelector('#modal-financial-entry form');
  form.finDescription.value = 'Pacote Banho e Tosa Mensal';
  form.finAmount.value = '250.00';
  form.finCategory.value = 'Serviços';
  form.finDate.value = '2026-09-15';
  form.finPaymentMethod.value = 'Cartão de Crédito';
  form.finStatus.value = 'Pago';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
await new Promise(r => setTimeout(r, 400));
const finSaved = await evalInPage(`PetDatabase.financialEntries.some(f => f.description === 'Pacote Banho e Tosa Mensal')`);
console.log("Financial entry saved successfully:", finSaved);

// 3. Submit Client
await evalInPage(`App.openModal('modal-new-client')`);
await evalInPage(`(() => {
  const form = document.querySelector('#modal-new-client form');
  form.clientName.value = 'Beatriz Albuquerque';
  form.clientPhone.value = '(61) 99123-4567';
  form.clientEmail.value = 'beatriz@email.com';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
await new Promise(r => setTimeout(r, 400));
const clientSaved = await evalInPage(`PetDatabase.clients.some(c => c.name === 'Beatriz Albuquerque')`);
console.log("Client saved successfully:", clientSaved);

// 4. Submit Pet
await evalInPage(`App.openModal('modal-new-pet')`);
await evalInPage(`(() => {
  const form = document.querySelector('#modal-new-pet form');
  form.petName.value = 'Pipoca';
  form.petSpecies.value = 'Cão';
  form.petBreed.value = 'Poodle Toy';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
await new Promise(r => setTimeout(r, 400));
const petSaved = await evalInPage(`PetDatabase.pets.some(p => p.name === 'Pipoca')`);
console.log("Pet saved successfully:", petSaved);

// 5. Submit Appointment
await evalInPage(`App.openModal('modal-new-appointment')`);
await evalInPage(`(() => {
  const form = document.querySelector('#modal-new-appointment form');
  form.appPet.value = 'Pipoca (Beatriz Albuquerque)';
  form.appService.value = 'Banho';
  form.appProf.value = 'João Silva';
  form.appTime.value = '11:00';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
await new Promise(r => setTimeout(r, 400));
const appSaved = await evalInPage(`PetDatabase.scheduleGrid.some(a => a.pet === 'Pipoca')`);
console.log("Appointment saved successfully:", appSaved);
await evalInPage(`App.closeAllModals()`);

console.log("=== Testing Responsiveness on Tablet (768x1024) ===");
await setViewport(768, 1024);
await evalInPage(`App.navigate('dashboard')`);
await new Promise(r => setTimeout(r, 500));
await saveScreenshot(`responsive_dashboard_tablet.png`);
await evalInPage(`App.navigate('financeiro')`);
await new Promise(r => setTimeout(r, 500));
await saveScreenshot(`responsive_financial_tablet.png`);

console.log("=== Testing Responsiveness on Mobile (375x812) ===");
await setViewport(375, 812);
await evalInPage(`App.navigate('dashboard')`);
await new Promise(r => setTimeout(r, 500));
await saveScreenshot(`responsive_dashboard_mobile.png`);
await evalInPage(`App.navigate('financeiro')`);
await new Promise(r => setTimeout(r, 500));
await saveScreenshot(`responsive_financial_mobile.png`);

// Test mobile sidebar toggle
await evalInPage(`App.toggleSidebar()`);
await new Promise(r => setTimeout(r, 500));
await saveScreenshot(`responsive_sidebar_mobile_open.png`);
await evalInPage(`App.closeSidebar()`);

console.log("\n=== Console Errors Report ===");
console.log("Total errors detected:", consoleErrors.length);
for (const err of consoleErrors) {
  console.log("Error:", JSON.stringify(err));
}

ws.close();
chromeProcess.kill();
await chromeProcess.status;
console.log("\nAudit execution completed successfully!");
