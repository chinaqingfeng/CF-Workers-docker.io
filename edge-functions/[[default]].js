// EdgeOne Pages Edge Function - Docker Hub 镜像代理
// 路由: 此文件位于 /edge-functions/[[default]].js，是根目录的 catch-all
// 接管所有未匹配静态资源的请求路径（/、/v2/...、/token 等）

let hub_host = 'registry-1.docker.io';
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

function routeByHosts(host) {
	const routes = {
		"quay": "quay.io",
		"gcr": "gcr.io",
		"k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io",
		"ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io",
		"nvcr": "nvcr.io",
		"test": "registry-1.docker.io",
	};
	if (host in routes) return [routes[host], false];
	else return [hub_host, true];
}

const PREFLIGHT_INIT = {
	headers: new Headers({
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
		'access-control-max-age': '1728000',
	}),
};

function makeRes(body, status = 200, headers = {}) {
	headers['access-control-allow-origin'] = '*';
	return new Response(body, { status, headers });
}

function newUrl(urlStr, base) {
	try { return new URL(urlStr, base); }
	catch (err) { console.error(err); return null; }
}

async function nginx() {
	return `<!DOCTYPE html>
<html><head><title>Welcome to nginx!</title>
<style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif;}</style>
</head><body><h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p></body></html>`;
}

async function searchInterface() {
	return `<!DOCTYPE html>
<html><head><title>Docker Hub 镜像搜索</title>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
:root{--primary-color:#0066ff;--primary-dark:#0052cc;--gradient-start:#1a90ff;--gradient-end:#003eb3;--text-color:#fff;--transition-time:.3s}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,var(--gradient-start) 0%,var(--gradient-end) 100%);padding:20px;color:var(--text-color)}
.container{text-align:center;width:100%;max-width:800px;padding:20px;display:flex;flex-direction:column;justify-content:center;min-height:60vh}
.title{font-size:2.3em;margin-bottom:10px;text-shadow:0 2px 10px rgba(0,0,0,.2);font-weight:700}
.subtitle{color:rgba(255,255,255,.9);font-size:1.1em;margin-bottom:25px;line-height:1.4}
.search-container{display:flex;align-items:stretch;width:100%;max-width:600px;margin:0 auto;height:55px;box-shadow:0 10px 25px rgba(0,0,0,.15);border-radius:12px;overflow:hidden}
#search-input{flex:1;padding:0 20px;font-size:16px;border:none;outline:none;height:100%}
#search-button{width:60px;background-color:var(--primary-color);border:none;cursor:pointer;height:100%;display:flex;align-items:center;justify-content:center}
#search-button:hover{background-color:var(--primary-dark)}
.tips{color:rgba(255,255,255,.8);margin-top:20px;font-size:.9em}
</style></head>
<body><div class="container">
<h1 class="title">Docker Hub 镜像搜索</h1>
<p class="subtitle">快速查找、下载和部署 Docker 容器镜像</p>
<div class="search-container">
<input type="text" id="search-input" placeholder="输入关键词搜索镜像，如: nginx, mysql, redis...">
<button id="search-button" title="搜索">
<svg width="20" height="20" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M13 5l7 7-7 7M5 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
</button></div>
<p class="tips">基于 EdgeOne Pages 边缘函数构建</p>
</div><script>
function performSearch(){const q=document.getElementById('search-input').value;if(q)window.location.href='/search?q='+encodeURIComponent(q);}
document.getElementById('search-button').addEventListener('click',performSearch);
document.getElementById('search-input').addEventListener('keypress',e=>{if(e.key==='Enter')performSearch();});
window.addEventListener('load',()=>document.getElementById('search-input').focus());
</script></body></html>`;
}

// =========== EdgeOne Pages 入口 ===========
export default async function onRequest(context) {
	const { request, env = {} } = context;
	const getReqHeader = (key) => request.headers.get(key);

	let url = new URL(request.url);
	const userAgentHeader = request.headers.get('User-Agent');
	const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
	if (env.UA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(env.UA));
	const workers_url = `https://${url.hostname}`;

	const ns = url.searchParams.get('ns');
	const hostname = url.searchParams.get('hubhost') || url.hostname;
	const hostTop = hostname.split('.')[0];

	let checkHost;
	if (ns) {
		hub_host = (ns === 'docker.io') ? 'registry-1.docker.io' : ns;
	} else {
		checkHost = routeByHosts(hostTop);
		hub_host = checkHost[0];
	}

	const fakePage = checkHost ? checkHost[1] : false;
	console.log(`域名头部: ${hostTop} 反代地址: ${hub_host} searchInterface: ${fakePage}`);
	url.hostname = hub_host;

	const hubParams = ['/v1/search', '/v1/repositories'];
	if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk)) && 屏蔽爬虫UA.length > 0) {
		return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
	} else if ((userAgent && userAgent.includes('mozilla')) || hubParams.some(param => url.pathname.includes(param))) {
		if (url.pathname == '/') {
			if (env.URL302) return Response.redirect(env.URL302, 302);
			else if (env.URL) {
				if (env.URL.toLowerCase() == 'nginx') {
					return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
				} else return fetch(new Request(env.URL, request));
			} else if (fakePage) {
				return new Response(await searchInterface(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
			}
		} else {
			if (url.pathname.startsWith('/v1/')) url.hostname = 'index.docker.io';
			else if (fakePage) url.hostname = 'hub.docker.com';
			if (url.searchParams.get('q')?.includes('library/') && url.searchParams.get('q') != 'library/') {
				const search = url.searchParams.get('q');
				url.searchParams.set('q', search.replace('library/', ''));
			}
			return fetch(new Request(url, request));
		}
	}

	if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
		let modifiedUrl = url.toString().replace(/%3A(?=.*?&)/, '%3Alibrary%2F');
		url = new URL(modifiedUrl);
	}

	if (url.pathname.includes('/token')) {
		const token_parameter = {
			headers: {
				'Host': 'auth.docker.io',
				'User-Agent': getReqHeader("User-Agent"),
				'Accept': getReqHeader("Accept"),
				'Accept-Language': getReqHeader("Accept-Language"),
				'Accept-Encoding': getReqHeader("Accept-Encoding"),
				'Connection': 'keep-alive',
				'Cache-Control': 'max-age=0'
			}
		};
		const token_url = auth_url + url.pathname + url.search;
		return fetch(new Request(token_url, request), token_parameter);
	}

	if (hub_host == 'registry-1.docker.io' && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
		url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
	}

	if (url.pathname.startsWith('/v2/') && (
		url.pathname.includes('/manifests/') ||
		url.pathname.includes('/blobs/') ||
		url.pathname.includes('/tags/') ||
		url.pathname.endsWith('/tags/list')
	)) {
		let repo = '';
		const v2Match = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/);
		if (v2Match) repo = v2Match[1];

		if (repo) {
			const tokenUrl = `${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`;
			const tokenRes = await fetch(tokenUrl, {
				headers: {
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0'
				}
			});
			const tokenData = await tokenRes.json();
			const token = tokenData.token;
			const parameter = {
				headers: {
					'Host': hub_host,
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0',
					'Authorization': `Bearer ${token}`
				}
			};
			if (request.headers.has("X-Amz-Content-Sha256")) {
				parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
			}
			const original_response = await fetch(new Request(url, request), parameter);
			const new_response_headers = new Headers(original_response.headers);
			const status = original_response.status;
			if (new_response_headers.get("Www-Authenticate")) {
				const re = new RegExp(auth_url, 'g');
				new_response_headers.set("Www-Authenticate", original_response.headers.get("Www-Authenticate").replace(re, workers_url));
			}
			if (new_response_headers.get("Location")) {
				return httpHandler(request, new_response_headers.get("Location"), hub_host);
			}
			return new Response(original_response.body, { status, headers: new_response_headers });
		}
	}

	const parameter = {
		headers: {
			'Host': hub_host,
			'User-Agent': getReqHeader("User-Agent"),
			'Accept': getReqHeader("Accept"),
			'Accept-Language': getReqHeader("Accept-Language"),
			'Accept-Encoding': getReqHeader("Accept-Encoding"),
			'Connection': 'keep-alive',
			'Cache-Control': 'max-age=0'
		}
	};
	if (request.headers.has("Authorization")) parameter.headers.Authorization = getReqHeader("Authorization");
	if (request.headers.has("X-Amz-Content-Sha256")) parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");

	const original_response = await fetch(new Request(url, request), parameter);
	const new_response_headers = new Headers(original_response.headers);
	const status = original_response.status;

	if (new_response_headers.get("Www-Authenticate")) {
		const re = new RegExp(auth_url, 'g');
		new_response_headers.set("Www-Authenticate", original_response.headers.get("Www-Authenticate").replace(re, workers_url));
	}
	if (new_response_headers.get("Location")) {
		return httpHandler(request, new_response_headers.get("Location"), hub_host);
	}

	return new Response(original_response.body, { status, headers: new_response_headers });
}

function httpHandler(req, pathname, baseHost) {
	const reqHdrRaw = req.headers;
	if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
		return new Response(null, PREFLIGHT_INIT);
	}
	const reqHdrNew = new Headers(reqHdrRaw);
	reqHdrNew.delete("Authorization");
	const urlObj = newUrl(pathname, 'https://' + baseHost);
	return proxy(urlObj, {
		method: req.method,
		headers: reqHdrNew,
		redirect: 'follow',
		body: req.body
	}, '');
}

async function proxy(urlObj, reqInit, rawLen) {
	const res = await fetch(urlObj.href, reqInit);
	const resHdrNew = new Headers(res.headers);
	if (rawLen) {
		const newLen = res.headers.get('content-length') || '';
		if (rawLen !== newLen) {
			return makeRes(res.body, 400, {
				'--error': `bad len: ${newLen}, except: ${rawLen}`,
				'access-control-expose-headers': '--error',
			});
		}
	}
	resHdrNew.set('access-control-expose-headers', '*');
	resHdrNew.set('access-control-allow-origin', '*');
	resHdrNew.set('Cache-Control', 'max-age=1500');
	resHdrNew.delete('content-security-policy');
	resHdrNew.delete('content-security-policy-report-only');
	resHdrNew.delete('clear-site-data');
	return new Response(res.body, { status: res.status, headers: resHdrNew });
}

async function ADD(envadd) {
	let addtext = envadd.replace(/[	 |"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, -1);
	return addtext.split(',');
}
