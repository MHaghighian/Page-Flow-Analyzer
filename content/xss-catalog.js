/* DOM Hacker — PortSwigger / DOM Invader source & sink catalog (MAIN world). */
(function () {
  if (globalThis.__DH_CATALOG__) return;

  const sources = [
    'location', 'location.href', 'location.hash', 'location.search', 'location.pathname',
    'document.URL', 'document.documentURI', 'document.baseURI', 'document.URLUnencoded',
    'document.referrer', 'document.cookie', 'window.name',
    'history.state', 'localStorage', 'sessionStorage', 'indexedDB',
    'postMessage', 'network.response', 'websocket.in', 'broadcastChannel', 'eventSource',
  ];

  const sinks = {
    'jQuery.globalEval': { rank: 1, attackClass: 'xss' },
    eval: { rank: 2, attackClass: 'xss' },
    Function: { rank: 3, attackClass: 'xss' },
    execScript: { rank: 4, attackClass: 'xss' },
    setTimeout: { rank: 5, attackClass: 'xss' },
    setInterval: { rank: 6, attackClass: 'xss' },
    setImmediate: { rank: 7, attackClass: 'xss' },
    msSetImmediate: { rank: 7, attackClass: 'xss' },
    'script.src': { rank: 8, attackClass: 'xss' },
    'script.textContent': { rank: 9, attackClass: 'xss' },
    'script.text': { rank: 10, attackClass: 'xss' },
    'script.innerText': { rank: 11, attackClass: 'xss' },
    'script.innerHTML': { rank: 12, attackClass: 'xss' },
    'script.appendChild': { rank: 13, attackClass: 'xss' },
    'script.append': { rank: 14, attackClass: 'xss' },
    'document.write': { rank: 15, attackClass: 'xss' },
    'document.writeln': { rank: 16, attackClass: 'xss' },
    jQuery: { rank: 17, attackClass: 'xss' },
    'jQuery.$': { rank: 18, attackClass: 'xss' },
    'jQuery.constructor': { rank: 19, attackClass: 'xss' },
    'jQuery.parseHTML': { rank: 20, attackClass: 'xss' },
    'jQuery.has': { rank: 20, attackClass: 'xss' },
    'jQuery.init': { rank: 20, attackClass: 'xss' },
    'jQuery.index': { rank: 20, attackClass: 'xss' },
    'jQuery.add': { rank: 20, attackClass: 'xss' },
    'jQuery.append': { rank: 20, attackClass: 'xss' },
    'jQuery.appendTo': { rank: 20, attackClass: 'xss' },
    'jQuery.after': { rank: 20, attackClass: 'xss' },
    'jQuery.insertAfter': { rank: 20, attackClass: 'xss' },
    'jQuery.before': { rank: 20, attackClass: 'xss' },
    'jQuery.insertBefore': { rank: 20, attackClass: 'xss' },
    'jQuery.html': { rank: 20, attackClass: 'xss' },
    'jQuery.prepend': { rank: 20, attackClass: 'xss' },
    'jQuery.prependTo': { rank: 20, attackClass: 'xss' },
    'jQuery.replaceWith': { rank: 20, attackClass: 'xss' },
    'jQuery.replaceAll': { rank: 20, attackClass: 'xss' },
    'jQuery.wrap': { rank: 20, attackClass: 'xss' },
    'jQuery.wrapAll': { rank: 20, attackClass: 'xss' },
    'jQuery.wrapInner': { rank: 20, attackClass: 'xss' },
    'jQuery.prop.innerHTML': { rank: 20, attackClass: 'xss' },
    'jQuery.prop.outerHTML': { rank: 20, attackClass: 'xss' },
    'element.innerHTML': { rank: 21, attackClass: 'xss' },
    'element.outerHTML': { rank: 22, attackClass: 'xss' },
    'element.insertAdjacentHTML': { rank: 23, attackClass: 'xss' },
    'iframe.srcdoc': { rank: 24, attackClass: 'xss' },
    'location.href': { rank: 25, attackClass: 'redirect' },
    'location.replace': { rank: 26, attackClass: 'redirect' },
    'location.assign': { rank: 27, attackClass: 'redirect' },
    location: { rank: 28, attackClass: 'redirect' },
    'window.open': { rank: 29, attackClass: 'redirect' },
    'iframe.src': { rank: 30, attackClass: 'link' },
    javascriptURL: { rank: 31, attackClass: 'xss' },
    'jQuery.attr.onclick': { rank: 32, attackClass: 'xss' },
    'element.setAttribute.onclick': { rank: 33, attackClass: 'xss' },
    createContextualFragment: { rank: 34, attackClass: 'xss' },
    'document.implementation.createHTMLDocument': { rank: 35, attackClass: 'xss' },
    'xhr.open': { rank: 36, attackClass: 'header' },
    'xhr.send': { rank: 36, attackClass: 'header' },
    fetch: { rank: 36, attackClass: 'header' },
    'fetch.body': { rank: 36, attackClass: 'header' },
    'xhr.setRequestHeader.name': { rank: 37, attackClass: 'header' },
    'xhr.setRequestHeader.value': { rank: 38, attackClass: 'header' },
    'jQuery.attr.href': { rank: 39, attackClass: 'link' },
    'jQuery.attr.src': { rank: 40, attackClass: 'link' },
    'jQuery.attr.data': { rank: 41, attackClass: 'link' },
    'jQuery.attr.action': { rank: 42, attackClass: 'link' },
    'jQuery.attr.formaction': { rank: 43, attackClass: 'link' },
    'form.action': { rank: 49, attackClass: 'link' },
    'input.formaction': { rank: 50, attackClass: 'link' },
    'button.formaction': { rank: 51, attackClass: 'link' },
    'element.setAttribute.href': { rank: 53, attackClass: 'link' },
    'element.setAttribute.src': { rank: 54, attackClass: 'link' },
    'element.setAttribute.data': { rank: 55, attackClass: 'link' },
    'element.setAttribute.action': { rank: 56, attackClass: 'link' },
    'element.setAttribute.formaction': { rank: 57, attackClass: 'link' },
    'webdatabase.executeSql': { rank: 58, attackClass: 'sql' },
    'document.domain': { rank: 59, attackClass: 'domain' },
    'history.pushState': { rank: 60, attackClass: 'history' },
    'history.replaceState': { rank: 61, attackClass: 'history' },
    'xhr.setRequestHeader': { rank: 62, attackClass: 'header' },
    websocket: { rank: 63, attackClass: 'websocket' },
    'anchor.href': { rank: 64, attackClass: 'link' },
    'JSON.parse': { rank: 66, attackClass: 'json' },
    'document.cookie': { rank: 67, attackClass: 'cookie' },
    'localStorage.setItem': { rank: 68, attackClass: 'storage' },
    'sessionStorage.setItem': { rank: 70, attackClass: 'storage' },
    'element.outerText': { rank: 72, attackClass: 'xss' },
    'element.innerText': { rank: 73, attackClass: 'other' },
    'element.textContent': { rank: 74, attackClass: 'other' },
    'element.style.cssText': { rank: 75, attackClass: 'other' },
    RegExp: { rank: 76, attackClass: 'regex' },
    'window.name': { rank: 77, attackClass: 'other' },
    'document.evaluate': { rank: 86, attackClass: 'xpath' },
    'setHTML': { rank: 23, attackClass: 'xss' },
    'setHTMLUnsafe': { rank: 23, attackClass: 'xss' },
    'DOMParser.parseFromString': { rank: 34, attackClass: 'xss' },
    'postMessage.out': { rank: 40, attackClass: 'postmessage' },
    'websocket.send': { rank: 63, attackClass: 'websocket' },
    'fetch.headers': { rank: 37, attackClass: 'header' },
    EventSource: { rank: 65, attackClass: 'other' },
    'input.value': { rank: 80, attackClass: 'other' },
  };

  function attackClassFor(sink) {
    const meta = sinks[sink];
    if (meta) return meta.attackClass;
    const s = String(sink || '');
    if (/eval|Function|execScript|setTimeout|setInterval|innerHTML|outerHTML|insertAdjacent|document\.write|srcdoc|parseHTML|createContextual|script\.|globalEval|javascript/i.test(s)) return 'xss';
    if (/location|window\.open/i.test(s)) return 'redirect';
    if (/cookie/i.test(s)) return 'cookie';
    if (/websocket|WebSocket/i.test(s)) return 'websocket';
    if (/href|src|action|formaction/i.test(s)) return 'link';
    if (/localStorage|sessionStorage/i.test(s)) return 'storage';
    if (/postMessage/i.test(s)) return 'postmessage';
    if (/Header|fetch|xhr/i.test(s)) return 'header';
    if (/JSON\.parse/i.test(s)) return 'json';
    if (/evaluate/i.test(s)) return 'xpath';
    if (/executeSql/i.test(s)) return 'sql';
    if (/document\.domain/i.test(s)) return 'domain';
    if (/RegExp/i.test(s)) return 'regex';
    if (/pushState|replaceState/i.test(s)) return 'history';
    return 'other';
  }

  function rankFor(sink) {
    return sinks[sink]?.rank ?? 90;
  }

  function severityFor(rank, encoded) {
    if (encoded && rank >= 21 && rank <= 24) return 'info';
    if (rank <= 16) return 'high';
    if (rank <= 35) return 'medium';
    return 'low';
  }

  globalThis.__DH_CATALOG__ = {
    sources,
    sinks,
    sourceCount: sources.length,
    sinkCount: Object.keys(sinks).length,
    attackClassFor,
    rankFor,
    severityFor,
  };
})();
