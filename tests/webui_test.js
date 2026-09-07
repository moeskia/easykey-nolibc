const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('module/webroot/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length);
new Function(script);
const directory = '/data/adb/modules/Easy_Key/';
const initial = 'click=echo old_click\nlong=echo old_long\ndouble=echo old_double';
const library = JSON.stringify([{ id: 'one', type: 'direct', name: '命令', content: 'echo test' }]);

  async function setup(format = 'object', prepare) {
    const files = new Map([['config.ini', initial], ['repo.json', library], ['repo.default.json', library]]);
    const messages = [];
    const calls = [];
    const writes = [];
    const faults = {};
    const elements = new Map();
    const element = () => {
      const classes = new Set();
      return {
        style: {}, value: '', disabled: false, textContent: '', innerText: '',
        classList: {
          add: (...names) => names.forEach(name => classes.add(name)),
          remove: (...names) => names.forEach(name => classes.delete(name)),
          contains: name => classes.has(name),
          toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
        },
        addEventListener() {}, setAttribute() {}, append() {}, appendChild() {}
      };
    };
    ids.forEach(id => elements.set(id, element()));
    const result = (errno, stdout = '', stderr = '') => {
      const value = { errno, stdout, stderr };
      return format === 'string' ? stdout : format === 'json' ? JSON.stringify(value) : value;
    };
    const exec = async command => {
      calls.push(command);
      const write = command.match(/^printf '%s' '([^']*)' \| base64 -d > (\S+)\.tmp\.\$\$/);
      if (write) {
        const name = write[2].slice(directory.length);
        const text = Buffer.from(write[1], 'base64').toString('utf8');
        writes.push({ name, text });
        if (faults.beforeWrite) await faults.beforeWrite();
        if (faults.write) return result(1, '', 'write failed');
        files.set(name, text);
        return result(0, 'easykey_write_ok');
      }
      if (command === '/data/adb/ksu/bin/busybox sh ' + directory + 'reload.sh 2>&1')
        return faults.reload ? result(1, 'flock: 9: Bad file descriptor') : result(0, 'easykey_reload_ok');
      const sections = [...command.matchAll(/printf '\\n:([a-z_]+)_ok:'; base64 < ([^;\s]+); printf ':[a-z_]+_end'; else printf '\\n:[a-z_]+_missing'; fi/g)];
      if (command.startsWith('pid=$(pidof') || sections.length) {
        let out = command.startsWith('pid=$(pidof')
          ? 'ek_pid=123|ek_version=v3|ek_state=S|ek_input=/dev/input/event0'
          : '';
        for (const section of sections) {
          const tag = section[1];
          const name = section[2].slice(directory.length);
          if (!files.has(name)) out += `\n:${tag}_missing`;
          else if (faults.read === name) out += `\n:${tag}_ok:`;
          else if (faults.fileCheck) continue;
          else out += `\n:${tag}_ok:` + Buffer.from(files.get(name)).toString('base64') + (faults.incomplete ? '' : `:${tag}_end`);
        }
        return result(0, out);
      }
      throw new Error('Unexpected shell command: ' + command);
    };
    const context = vm.createContext({
      console, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
      setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
      alert: message => messages.push(message),
      localStorage: { getItem() { return null; }, setItem() {} },
      document: {
        body: element(), documentElement: element(), addEventListener() {},
        createElement: element, createDocumentFragment: element,
        getElementById: id => elements.get(id),
        querySelectorAll: selector => selector === 'button, input, textarea' ? [...elements.values()] : []
      },
      window: { ksu: { exec, toast: message => messages.push(message) }, innerWidth: 390, innerHeight: 844, addEventListener() {} }
    });
    if (prepare) prepare(files, faults);
    vm.runInContext(script, context);
    await vm.runInContext('refreshPromise', context);
    return { files, faults, messages, calls, writes, elements, run: code => vm.runInContext(code, context) };
  }

async function test() {
  for (const format of ['object', 'json', 'string']) {
    const restarted = await setup(format);
    await restarted.run('reloadBackend()');
    assert(restarted.messages.includes('EasyKey 已重载'));
    restarted.faults.reload = true;
    await restarted.run('reloadBackend()');
    assert(restarted.messages.includes('重载失败：flock: 9: Bad file descriptor'));
    assert.equal(restarted.run('busy'), false);
    const restored = await setup(format);
    restored.files.delete('repo.json');
    await restored.run('refreshAll()');
    assert.equal(restored.run('repoReady'), true);
    assert.equal(restored.files.get('repo.json'), library);
    assert.equal(restored.files.get('config.ini'), initial);
    const failedInit = await setup(format);
    failedInit.files.delete('repo.json');
    failedInit.faults.write = true;
    await failedInit.run('refreshAll()');
    assert.equal(failedInit.run('repoReady'), false);
    assert.equal(failedInit.files.has('repo.json'), false);
    const unchecked = await setup(format);
    unchecked.faults.fileCheck = true;
    await unchecked.run('refreshAll()');
    assert.equal(unchecked.run('repoReady'), false);
    assert.equal(unchecked.files.get('repo.json'), library);
    assert.equal(unchecked.writes.length, 0);
    const app = await setup(format);
    await app.run('refreshAll()');
    assert.equal(app.run('iniReady && repoReady'), true);
    assert.equal(app.run('iniData.long'), 'echo old_long');
    app.faults.read = 'config.ini';
    await app.run('refreshAll()');
    assert.equal(app.run('iniReady'), false);
    assert.equal(app.run('iniData.long'), 'echo old_long');
    await app.run('selectCommand({type:"direct",content:"echo changed"})');
    assert.equal(app.writes.length, 0);
    delete app.faults.read;
    await app.run('refreshAll()');
    await app.run('refreshAll({ data: false })');
    assert.equal(app.run('iniReady'), true);
    await app.run('selectCommand({type:"direct",content:"echo changed"})');
    assert.equal(app.run('iniData.click'), 'echo changed');
    assert.equal(app.files.get('config.ini'), 'click=echo changed\nlong=echo old_long\ndouble=echo old_double');
    app.faults.write = true;
    await app.run('selectCommand(null)');
    assert.equal(app.run('iniData.click'), 'echo changed');
    assert.equal(app.run('iniReady'), false);
    assert.equal(app.run('busy'), false);
  }
  const app = await setup();
  await app.run('refreshAll()');
  let release;
  app.faults.beforeWrite = () => new Promise(resolve => { release = resolve; });
  app.run('openSelectDialog("click")');
  const saving = app.run('selectCommand({type:"direct",content:"echo new_click"})');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.run('busy'), true);
  assert.equal(app.elements.get('status-reload').disabled, true);
  const callCount = app.calls.length;
  await app.run('refreshAll()');
  await app.run('reloadBackend()');
  app.run('openSelectDialog("long")');
  await app.run('selectCommand({type:"direct",content:"echo ignored"})');
  assert.equal(app.calls.length, callCount);
  assert.equal(app.run('currentSelectTrigger'), 'click');
  release();
  await saving;
  delete app.faults.beforeWrite;
  app.run('openSelectDialog("long")');
  await app.run('selectCommand({type:"direct",content:"echo new_long"})');
  assert.equal(app.run('iniData.click'), 'echo new_click');
  assert.equal(app.run('iniData.long'), 'echo new_long');
  await app.run('selectCommand(null)');
  assert.equal(app.run('iniData.long'), '');
  assert.equal(app.run('busy'), false);
  app.files.set('repo.json', '[null]');
  await app.run('refreshAll()');
  assert.equal(app.run('repoReady'), false);
  assert.equal(app.run('repoData.length'), 1);
  const writes = app.writes.length;
  await app.run('saveEditedCommand()');
  await app.run('executeDeleteCommand()');
  assert.equal(app.writes.length, writes);
  app.files.set('repo.json', library);
  await app.run('refreshAll()');
  await app.run('reloadBackend()');
  assert(app.messages.includes('EasyKey 已重载'));
  assert.equal(app.run('busy'), false);
  assert.equal(app.elements.get('status-reload').textContent, '重载');
  app.faults.reload = true;
  await app.run('reloadBackend()');
  assert(app.messages.some(message => message.includes('重载失败')));
  assert.equal(app.run('busy'), false);
    const missing = await setup('string', files => files.delete('config.ini'));
    await missing.run('refreshAll()');
  assert.equal(missing.run('iniReady'), false);
  assert.equal(missing.elements.get('val-click').innerText, '读取失败');
  missing.files.set('config.ini', '');
  await missing.run('refreshAll()');
  assert.equal(missing.run('iniReady'), true);
  assert.equal(missing.run('iniData.click'), '');
  missing.faults.incomplete = true;
  await missing.run('refreshAll()');
  assert.equal(missing.run('iniReady'), false);
    const parser = await setup();
  for (const text of ['click=x\nclick=y', 'click=x\nlong =y', 'unknown=x', 'click=x\0y', 'click=' + 'x'.repeat(512)])
    assert.throws(() => parser.run('parseIniText(' + JSON.stringify(text) + ')'));
  assert.equal(parser.run('parseIniText("click=  echo \\\"a  b\\\"  \\r\\n").click'), '  echo "a  b"  ');
  assert.equal(parser.run('parseIniText("double=echo only").click'), '');
  assert.equal(parser.run('parseIniText("click=" + "中".repeat(170)).click.length'), 170);
  assert.throws(() => parser.run('parseIniText("click=" + "中".repeat(171))'));
  assert.throws(() => parser.run('parseRepoText(\'[ {"id":"x","type":"direct","content":"x"}, {"id":"x","type":"direct","content":"y"} ]\')'));
    const edit = await setup();
  await edit.run('refreshAll()');
  edit.run('openEditDialog("one")');
  edit.elements.get('edit-content').value = 'echo edited';
  await edit.run('saveEditedCommand()');
  assert.equal(JSON.parse(edit.files.get('repo.json'))[0].content, 'echo edited');
  assert.equal(edit.files.get('config.ini'), initial);
  await edit.run('executeDeleteCommand()');
  assert.equal(edit.files.get('repo.json'), '[]');
  assert.equal(edit.files.get('config.ini'), initial);
  console.log('WebUI regression tests passed');
}

test().catch(error => { console.error(error); process.exitCode = 1; });
