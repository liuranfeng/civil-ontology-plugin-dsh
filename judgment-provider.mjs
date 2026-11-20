function approvedUrl(raw) {
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||
    !(u.hostname==='court.gov.cn'||u.hostname.endsWith('.court.gov.cn')))throw Error('请使用人民法院官方域名 court.gov.cn 下的 HTTPS 裁判原文链接。其他来源可作为待核线索。');
  u.hash='';
  return u.href;
}
function decodeEntities(text) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi,(original,key)=>{
    if(key[0]!=='#')return named[key.toLowerCase()];
    const cp=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):original;
  });
}
async function readPage(fetchImpl,url,signal) {
  let current=url;
  for(let n=0;n<4;n++){
    const response=await fetchImpl(current,{signal,redirect:'manual',credentials:'omit',headers:{Accept:'text/html,text/plain'}});
    if([301,302,303,307,308].includes(response.status)){
      const redirected=response.headers.get('location');
      await response.body?.cancel();
      if(!redirected)throw Error('法院网页重定向缺少地址。');
      current=approvedUrl(new URL(redirected,current).href);continue;
    }
    const mime=response.headers.get('content-type')||'';
    if(!response.ok||!/^text\/(html|plain)\b/i.test(mime)||!response.body){
      await response.body?.cancel();
      throw Error('未取得可读取的法院正文，网页可能需要登录、动态加载或提供原件。');
    }
    const chunks=[];let bytes=0;
    const reader=response.body.getReader();
    try {
      for(;;){
        const {done,value:chunk}=await reader.read();
        if(done)break;
        bytes+=chunk.byteLength;
        if(bytes>2*1024*1024){await reader.cancel();throw Error('公开页面过大，请提供相应裁判原件。');}
        chunks.push(Buffer.from(chunk));
      }
    } finally {reader.releaseLock();}
    const buf=Buffer.concat(chunks);
    const enc=mime.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||buf.subarray(0,4096).toString('latin1').match(/<meta[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
    const decoded=new TextDecoder(enc).decode(buf);
    let body=decoded;
    if(/^text\/html/i.test(mime)){
      body=decodeEntities(body.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|head|template)\b[^>]*>[^]*?<\/\1\s*>/gi,'')
        .replace(/<\/?(?:p|div|h[1-6]|tr|td|br|li)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,''));
    }
    body=body.replace(/\r/g,'').replace(/[\t\u00a0 ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if(body.length>200000)throw Error('页面正文超过核验范围，请提供相应裁判原件。');
    if(!/判\s*决\s*书|裁\s*定\s*书/.test(body)||!/本院认为|本院经审查认为|判决如下|裁定如下/.test(body))throw Error('该页面未提供可核验的裁判文书正文。');
    return {url:current,text:body,fetchedAt:new Date().toISOString()};
  }
  throw Error('法院网页重定向次数过多。');
}
// This provider reads public court documents. A host may install a different
// provider with the same interface; model tool arguments never supply the implementation.
export function createCourtWebJudgmentProvider({fetchImpl=globalThis.fetch}={}) {
  return {
    id:'cn-court-web',
    label:'法院公开原文',
    normalize:approvedUrl,
    async read(locator,{signal}) {
      const page=await readPage(fetchImpl,approvedUrl(locator),signal);
      return {kind:'judgment-text',locator:page.url,text:page.text};
    }
  };
}
