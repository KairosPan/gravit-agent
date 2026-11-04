// a fake XMLHttpRequest, the upload's carrier as wire/api.js uploadFile speaks to it: open, setRequestHeader and send are
// recorded; a test drives upload.onprogress, onload (a status and a responseText), onerror and abort. Nothing reaches a network.

export function fakeXhr() {
  const xhr = {
    opened: null, headers: /** @type {Record<string, string>} */ ({}), body: undefined, sent: false, aborted: false,
    status: 0, responseText: '',
    upload: { onprogress: null },
    onload: null, onerror: null, onabort: null, ontimeout: null,
    open(method, url) { xhr.opened = { method, url }; },
    setRequestHeader(name, value) {
      if (!xhr.opened) throw new Error('InvalidStateError: setRequestHeader before open');
      xhr.headers[name.toLowerCase()] = value;
    },
    send(body) { xhr.sent = true; xhr.body = body; },
    abort() { xhr.aborted = true; xhr.onabort?.(); },
    // the test's hand
    progress(loaded, total) { xhr.upload.onprogress?.({ loaded, total, lengthComputable: total !== undefined }); },
    answer(status, responseText) { xhr.status = status; xhr.responseText = responseText; xhr.onload?.(); },
    fail() { xhr.onerror?.(); },
  };
  return xhr;
}
