const fs = require('fs');
const buf = fs.readFileSync("Super Mario 64 (Europe) (En,Fr,De).n64");
const view = new Uint8Array(buf);
for (let i = 0; i < view.length; i += 2) {
    const tmp = view[i];
    view[i] = view[i+1];
    view[i+1] = tmp;
}
console.log(Buffer.from(view.subarray(0, 32)).toString('hex'));
