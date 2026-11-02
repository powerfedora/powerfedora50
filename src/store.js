// 极简 JSON 文件存储：原子写入（先写临时文件再改名），不依赖数据库
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) { this.dir = path.resolve(dir); fs.mkdirSync(this.dir, { recursive: true }); }

  file(name) {
    const f = path.resolve(this.dir, name);
    if (f !== this.dir && !f.startsWith(this.dir + path.sep)) throw new Error('非法路径');
    return f;
  }

  read(name, def) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch (e) { return def; }
  }

  write(name, val) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(val, null, 1));
    fs.renameSync(tmp, f);
  }

  list(sub) { try { return fs.readdirSync(this.file(sub)); } catch (e) { return []; } }
}

module.exports = { Store };
