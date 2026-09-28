const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function withPage(run, config) {
  const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], { cwd: __dirname + '/..' });
  const [line] = await once(server.stdout, 'data');
  const port = String(line).match(/port (\d+)/)[1];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Isolate all test traffic from production collectors and external services.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (config && url.pathname === '/live/event.json') return route.fulfill({ json: config });
      return route.continue();
    });
    await run(page, `http://127.0.0.1:${port}`);
  } finally { await browser.close(); server.kill(); }
}

const currentEvent = () => ({
  available: true,
  zoomUrl: 'https://us02web.zoom.us/j/12345678901', // Intercepted test fixture, never a real event.
  opensAt: new Date(Date.now() - 60000).toISOString(),
  closesAt: new Date(Date.now() + 3600000).toISOString(),
  watchUrl: ''
});

test('simplified caller page requires a nonempty question as well as consent', async () => {
  await withPage(async (page, base) => {
    await page.goto(base + '/');
    assert.equal(await page.locator('h1').innerText(), 'Ask the Black Kids');
    assert.equal(await page.getByText('What had happened was...', { exact: true }).count(), 0);
    assert.equal(await page.locator('textarea, input:not([type=checkbox])').count(), 1);
    assert.doesNotMatch(await page.locator('body').innerText(), /married besties|backstory/i);
    const question = page.getByLabel("What's your relationship question?");
    assert.equal(await question.getAttribute('aria-describedby'), 'question-help');
    assert.equal(await page.locator('#question-help').innerText(), "Write one clear question you can read when we bring you on. We'll ask for the details.");
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByRole('checkbox').check();
    assert.equal(await page.locator('#join').isDisabled(), true);
    await question.fill('   ');
    assert.equal(await page.locator('#join').isDisabled(), true);
    await question.fill('How can we communicate better?');
    assert.equal(await page.getByRole('button', { name: 'Join Zoom', exact: true }).isEnabled(), true);
    await question.fill('');
    assert.equal(await page.locator('#join').isDisabled(), true);
  }, currentEvent());
});

test('question survives reload only in session storage without submission or saved consent', async () => {
  await withPage(async (page, base) => {
    const requests = [];
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
    await page.goto(base + '/');
    await page.locator('#question').fill('How can we communicate better?');
    await page.getByRole('checkbox').check();
    await page.reload();
    assert.equal(await page.locator('#question').inputValue(), 'How can we communicate better?');
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    assert.equal(await page.locator('#join').isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.deepEqual(await page.evaluate(() => Object.values(sessionStorage)), ['How can we communicate better?']);
    assert.equal(requests.every(r => r.method === 'GET' && !r.body && !r.url.includes('communicate')), true);
    await page.locator('#question').fill('');
    await page.reload();
    assert.equal(await page.locator('#question').inputValue(), '');
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  }, currentEvent());
});

test('a current event requires affirmative consent and revokes access when unchecked', async () => {
  const config = currentEvent();
  await withPage(async (page, base) => {
    await page.goto(base + '/');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent === '');
    const join = page.getByRole('button', { name: 'Join Zoom', exact: true });
    assert.equal(await join.isDisabled(), true);
    await page.locator('#question').fill('How can we communicate better?');
    assert.equal(await join.isDisabled(), true);
    await page.getByRole('checkbox').check();
    assert.equal(await join.isEnabled(), true);
    await page.getByRole('checkbox').uncheck();
    assert.equal(await join.isDisabled(), true);
    await page.getByRole('checkbox').check();
    const request = page.waitForRequest(config.zoomUrl);
    await join.click();
    assert.equal((await request).url(), config.zoomUrl);
  }, config);
});

test('expired, future, missing and unsafe event details fail closed', async () => {
  for (const override of [
    { closesAt: '2026-09-26T23:59:00Z' },
    { opensAt: '2099-01-01T00:00:00Z' },
    { closesAt: '' }, { opensAt: '' },
    { zoomUrl: 'javascript:alert(1)' },
    { zoomUrl: 'https://zoom.us.evil.example/j/12345678901' },
    { zoomUrl: 'https://zoom.us/' },
    { zoomUrl: 'http://zoom.us/j/12345678901' },
    { available: false }, { available: 'true' }
  ]) {
    await withPage(async (page, base) => {
      await page.goto(base + '/');
      await page.waitForTimeout(80);
      assert.equal(await page.locator('#live-form').isVisible(), false);
      assert.equal(await page.locator('#submit.primary').isVisible(), true);
      assert.equal(await page.locator('#join').isDisabled(), true, JSON.stringify(override));
    }, { ...currentEvent(), ...override });
  }
});

test('only a current event can show a configured watch link', async () => {
  for (const active of [true, false]) {
    await withPage(async (page, base) => {
      await page.goto(base + '/');
      await page.waitForTimeout(80);
      const watch = page.getByRole('link', { name: 'Watch the live show' });
      assert.equal(await watch.isVisible(), active);
      if (active) assert.equal(await watch.getAttribute('href'), 'https://www.youtube.com/watch?v=test-only');
    }, { ...currentEvent(), available: active, watchUrl: 'https://www.youtube.com/watch?v=test-only' });
  }
});

test('an open tab automatically closes when the confirmed event ends', async () => {
  await withPage(async (page, base) => {
    await page.clock.install();
    await page.goto(base + '/');
    await page.locator('#question').fill('How can we communicate better?');
    await page.getByRole('checkbox').check();
    assert.equal(await page.locator('#join').isEnabled(), true);
    await page.clock.fastForward(3601000);
    assert.equal(await page.locator('#join').isDisabled(), true);
  }, currentEvent());
});

test('root, index and live alias use the approved entrance at all widths', async () => {
  require('node:fs').mkdirSync(__dirname + '/../artifacts', { recursive: true });
  await withPage(async (page, base) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/', '/index.html', '/live/']) {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal((await page.goto(base + route)).status(), 200);
        await page.waitForFunction(() => !document.querySelector('#next-event').hidden);
        assert.equal(await page.locator('#live-form').isVisible(), false);
        assert.match(await page.locator('#next-event').innerText(), /October 3, 2026.*8:00 PM EDT/);
        assert.equal(await page.locator('#submit.primary').getAttribute('href'), 'https://onlyblackkids.com/pages/ask-obk');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.doesNotMatch(await page.locator('body').innerText(), /married besties|what had happened was|Write your question and confirm/i);
        if (route === '/' && [390, 1440].includes(width)) await page.screenshot({ path: `${__dirname}/../artifacts/root-${width}.png`, fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
  });
});

test('storage denial leaves the question and consent gate usable', async () => {
  for (const blocked of ['getter', 'methods']) {
    await withPage(async (page, base) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(mode => {
        if (mode === 'getter') Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Denied'); } });
        else for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('Denied'); };
      }, blocked);
      await page.goto(base + '/');
      await page.locator('#question').fill('How can we communicate better?');
      await page.getByRole('checkbox').check();
      assert.equal(await page.locator('#join').isEnabled(), true);
      await page.locator('#question').fill('');
      assert.equal(await page.locator('#join').isDisabled(), true);
      assert.deepEqual(errors, []);
    }, currentEvent());
  }
});

test('open-state mobile preview is empty, unchecked and fits phone widths', async () => {
  const { mkdirSync } = require('node:fs');
  mkdirSync(__dirname + '/../artifacts', { recursive: true });
  await withPage(async (page, base) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + '/');
      await page.waitForFunction(() => document.querySelector('#status').textContent === '');
      assert.equal(await page.locator('#question').inputValue(), '');
      assert.equal(await page.getByRole('checkbox').isChecked(), false);
      assert.equal(await page.locator('#join').isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      // Preview annotation is test-only, not an invented production availability state.
      await page.evaluate(() => {
        const label = document.createElement('div');
        label.textContent = 'DESIGN PREVIEW · OPEN-ROOM EXAMPLE';
        label.style.cssText = 'position:fixed;top:0;left:0;width:100%;padding:9px;background:#1a1a1a;color:#fff;text-align:center;font:10px/1.4 sans-serif;letter-spacing:.08em;z-index:10';
        document.body.append(label);
      });
      await page.screenshot({ path: `${__dirname}/../artifacts/live-open-preview-${width}.png`, fullPage: true });
    }
  }, currentEvent());
});

test('configuration fetch failures keep the gate closed', async () => {
  await withPage(async (page, base) => {
    await page.route('**/live/event.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(base + '/');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#live-form').isVisible(), false);
    assert.equal(await page.locator('#submit.primary').isVisible(), true);
    assert.equal(await page.locator('#join').isDisabled(), true);
  });
});

test('unsafe watch links stay hidden and reload requires fresh consent', async () => {
  await withPage(async (page, base) => {
    await page.goto(base + '/');
    await page.locator('#question').fill('How can we communicate better?');
    await page.getByRole('checkbox').check();
    assert.equal(await page.locator('#join').isEnabled(), true);
    assert.equal(await page.getByRole('link', { name: 'Watch the live show' }).isVisible(), false);
    await page.reload();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    assert.equal(await page.locator('#join').isDisabled(), true);
  }, { ...currentEvent(), watchUrl: 'javascript:alert(1)' });
});

test('unconfirmed and past events never show next dates or an inactive form', async () => {
  for (const config of [
    { ...currentEvent(), available: false, scheduledAt: '2099-01-01T00:00:00Z' },
    { ...currentEvent(), scheduledAt: '2026-09-26T20:00:00-04:00', closesAt: '2026-09-26T20:30:00-04:00' }
  ]) await withPage(async (page, base) => {
    await page.goto(base + '/');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#live-form').isVisible(), false);
    assert.equal(await page.locator('#next-event').isVisible(), false);
    assert.equal(await page.locator('#submit.primary').isVisible(), true);
  }, config);
});

test('actual configured event opens at 8 PM, not early, and closes at 8:30 PM Eastern', async () => {
  await withPage(async (page, base) => {
    await page.clock.install({ time: new Date('2026-10-03T19:59:59-04:00') });
    await page.goto(base + '/');
    await page.waitForFunction(() => !document.querySelector('#next-event').hidden);
    assert.equal(await page.locator('#live-form').isVisible(), false);
    await page.clock.fastForward(1000);
    assert.equal(await page.locator('#live-form').isVisible(), true);
    assert.equal(await page.locator('#next-event').isVisible(), false);
    assert.equal(await page.locator('#submit').getAttribute('class'), '');
    await page.locator('#question').fill('A private question');
    await page.locator('#consent').check();
    assert.equal(await page.locator('#join').isEnabled(), true);
    await page.clock.fastForward(1799000);
    assert.equal(await page.locator('#join').isEnabled(), true);
    await page.clock.fastForward(1000);
    assert.equal(await page.locator('#join').isDisabled(), true);
    assert.equal(await page.locator('#live-form').isVisible(), false);
    assert.equal(await page.locator('#next-event').isVisible(), false);
    assert.equal(await page.locator('#submit.primary').isVisible(), true);
  });
});

test('without JavaScript submission remains primary and Zoom remains hidden', async () => {
  await withPage(async (page, base) => {
    await page.route('**/live/live.js', r => r.abort());
    await page.goto(base + '/');
    assert.equal(await page.locator('#live-form').isVisible(), false);
    assert.equal(await page.locator('#submit.primary').isVisible(), true);
  });
});
