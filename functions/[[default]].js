const ALLOWED_GITHUB_HOSTS = [
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'objects-origin.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'github-avatars.githubusercontent.com',
  'github-user-assets.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'media.githubusercontent.com',
  'cloud.githubusercontent.com',
  'camo.githubusercontent.com',
];

const DOCKER_HUB_REGISTRY = 'registry-1.docker.io';

const DOCKER_REGISTRY_MAP = {
  'ghcr.io': 'ghcr.io',
  'quay.io': 'quay.io',
  'gcr.io': 'gcr.io',
  'k8s.gcr.io': 'k8s.gcr.io',
  'registry.k8s.io': 'registry.k8s.io',
  'docker.cloudsmith.io': 'docker.cloudsmith.io',
  'mcr.microsoft.com': 'mcr.microsoft.com',
  'public.ecr.aws': 'public.ecr.aws',
};

const MAX_REDIRECTS = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

const REMOVE_REQUEST_HEADERS = [
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker',
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
  'cdn-loop', 'cf-connecting-o2o',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'x-edgeone-proxy-id', 'x-edgeone-request-id',
];

const REMOVE_RESPONSE_HEADERS = [
  'content-security-policy', 'content-security-policy-report-only',
  'strict-transport-security', 'connection', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'upgrade', 'alt-svc', 'x-runtime', 'x-github-request-id',
];

function buildGitHubRequest(request, targetUrl, targetHost) {
  const headers = new Headers(request.headers);
  for (const key of REMOVE_REQUEST_HEADERS) {
    headers.delete(key);
  }
  headers.set('Host', targetHost);
  headers.delete('Referer');
  headers.delete('Origin');

  const originalUA = headers.get('User-Agent') || '';
  if (originalUA.startsWith('git/')) {
    // For git clients, we should NOT force Accept to */* as it breaks Smart HTTP protocol
    if (!headers.has('Accept')) {
      headers.set('Accept', '*/*');
    }
  } else if (!originalUA || originalUA === '') {
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }

  return new Request(targetUrl, {
    method: request.method,
    headers: headers,
    body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : null,
    redirect: 'manual',
  });
}

function buildDockerRequest(request, targetUrl, registry, token) {
  const headers = new Headers();
  headers.set('Host', registry);
  headers.set('User-Agent', 'Docker-Client/24.0.0');
  headers.set('Accept-Encoding', 'gzip, deflate, br');

  if (token) {
    headers.set('Authorization', 'Bearer ' + token);
  }

  const path = new URL(targetUrl).pathname;
  if (path.includes('manifests')) {
    headers.set('Accept', 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json');
  }
  if (path.includes('blobs')) {
    headers.set('Accept', 'application/vnd.docker.image.rootfs.diff.tar.gzip, application/vnd.docker.distribution.manifest.v2+json, application/octet-stream, */*');
  }

  return new Request(targetUrl, {
    method: request.method,
    headers: headers,
    body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : null,
    redirect: 'manual',
  });
}

function cleanResponse(response) {
  const headers = new Headers(response.headers);
  
  // Update WWW-Authenticate
  const wwwAuth = headers.get('WWW-Authenticate');
  if (wwwAuth && wwwAuth.includes('github.com')) {
    headers.set('WWW-Authenticate', wwwAuth.replace(/realm="[^"]+"/, 'realm="GitHub Proxy"'));
  }

  // Remove problematic headers for EdgeOne Pages streaming
  headers.delete('X-Frame-Options');
  headers.delete('X-Content-Type-Options');
  headers.delete('Content-Length');
  headers.delete('X-XSS-Protection');
  headers.delete('X-UA-Compatible');

  // Remove HTTP/2 forbidden headers
  for (const key of REMOVE_RESPONSE_HEADERS) {
    headers.delete(key);
  }

  // Force binary stream type for Git/Docker data to bypass platform processing
  // But keep Git Smart HTTP content types to avoid "not a git repository" error
  const contentType = headers.get('Content-Type') || '';
  if (contentType.includes('git-upload-pack') || contentType.includes('docker')) {
    // If it's a small info/refs request, keep the original content type
    // If it's a large packfile, we could use octet-stream, but let's try keeping it first
    // headers.set('Content-Type', 'application/octet-stream');
  }

  // Restore CORS headers for general compatibility
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }

  // Disable all caching and optimization
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  return new Response(response.body, {
    status: response.status,
    headers: headers,
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (path.startsWith('/https://') || path.startsWith('/http://')) {
    return handleGitHubProxy(request, path, url.search);
  }

  if (path === '/v2' || path === '/v2/') {
    return new Response('{}', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Docker-Distribution-Api-Version': 'registry/2.0',
        ...CORS_HEADERS,
      },
    });
  }

  if (path.startsWith('/v2/')) {
    return handleDockerProxy(request, url);
  }

  if (path === '/' || path === '') {
    return new Response(JSON.stringify({
      service: 'EdgeOne GitHub & Docker Proxy',
      github: 'https://<domain>/https://github.com/...',
      git_clone: 'git clone https://<domain>/https://github.com/user/repo.git',
      docker_hub: 'docker pull <domain>/nginx',
      docker_third_party: 'docker pull <domain>/ghcr.io/user/repo',
      docker_mirror: '{"registry-mirrors": ["https://<domain>"]}',
    }, null, 2), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
}

async function handleGitHubProxy(request, path, search) {
  let targetUrl = path.substring(1);
  if (search) {
    targetUrl += search;
  }

  return await fetchGitHubWithRetry(request, targetUrl, 0);
}

async function fetchGitHubWithRetry(request, targetUrl, redirectCount) {
  if (redirectCount >= MAX_REDIRECTS) {
    return new Response('Too many redirects', { status: 502, headers: CORS_HEADERS });
  }

  let targetHost;
  try {
    const urlObj = new URL(targetUrl);
    targetHost = urlObj.hostname;
    
    // Support basic auth in URL by converting to Authorization header
    if (urlObj.username || urlObj.password) {
      const auth = btoa(decodeURIComponent(urlObj.username) + ':' + decodeURIComponent(urlObj.password));
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Authorization', 'Basic ' + auth);
      request = new Request(request, { headers: newHeaders });
      // Remove credentials from URL for the actual fetch
      urlObj.username = '';
      urlObj.password = '';
      targetUrl = urlObj.toString();
    }
  } catch (e) {
    return new Response('Invalid URL: ' + targetUrl, { status: 400, headers: CORS_HEADERS });
  }

  if (!ALLOWED_GITHUB_HOSTS.some(host => targetHost === host || targetHost.endsWith('.' + host)) && !isAmazonS3(targetUrl)) {
    return new Response('Domain not allowed: ' + targetHost, { status: 403, headers: CORS_HEADERS });
  }

  try {
    const proxyRequest = buildGitHubRequest(request, targetUrl, targetHost);
    const response = await fetch(proxyRequest);

    // Handle redirects manually to preserve headers like Authorization
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        // Resolve relative redirects
        const nextUrl = new URL(location, targetUrl).toString();
        return await fetchGitHubWithRetry(request, nextUrl, redirectCount + 1);
      }
    }

    return cleanResponse(response);
  } catch (e) {
    return new Response('GitHub proxy error: ' + e.message, { status: 502, headers: CORS_HEADERS });
  }
}

async function handleDockerProxy(request, url) {
  const path = url.pathname;
  const pathAfterV2 = path.substring(3); // Remove '/v2'

  let targetRegistry = DOCKER_HUB_REGISTRY;
  let targetPath = path;

  let isThirdParty = false;
  for (const [prefix, registry] of Object.entries(DOCKER_REGISTRY_MAP)) {
    if (pathAfterV2.startsWith('/' + prefix + '/') || pathAfterV2 === '/' + prefix) {
      targetRegistry = registry;
      targetPath = '/v2' + pathAfterV2.substring(prefix.length + 1);
      isThirdParty = true;
      break;
    }
  }

  // Docker Hub special handling: if not third party and no user prefix, add /library/
  // Example: /v2/wordpress/manifests/latest -> /v2/library/wordpress/manifests/latest
  if (!isThirdParty && targetRegistry === DOCKER_HUB_REGISTRY) {
    const parts = pathAfterV2.split('/').filter(Boolean);
    if (parts.length === 2) { // Just [image, action]
      targetPath = '/v2/library/' + parts[0] + '/' + parts[1] + (url.pathname.endsWith('/') ? '/' : '');
    } else if (parts.length === 3) { // [image, action, reference]
      targetPath = '/v2/library/' + parts[0] + '/' + parts[1] + '/' + parts[2];
    }
  }

  const targetUrl = 'https://' + targetRegistry + targetPath;

  try {
    let proxyRequest = buildDockerRequest(request, targetUrl, targetRegistry);
    let response = await fetch(proxyRequest);

    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        const token = await getDockerToken(wwwAuth);
        if (token) {
          proxyRequest = buildDockerRequest(request, targetUrl, targetRegistry, token);
          response = await fetch(proxyRequest);
        }
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        return await followRedirect(location, 0);
      }
    }

    return cleanResponse(response);
  } catch (e) {
    return new Response('Docker proxy error: ' + e.message, { status: 502, headers: CORS_HEADERS });
  }
}

async function getDockerToken(wwwAuth) {
  const params = parseWwwAuthenticate(wwwAuth);
  const realm = params.realm;
  if (!realm) return null;

  const service = params.service || '';
  const scope = params.scope || '';

  let tokenUrl = realm;
  const queryParams = [];
  if (service) queryParams.push('service=' + encodeURIComponent(service));
  if (scope) queryParams.push('scope=' + encodeURIComponent(scope));
  if (queryParams.length > 0) {
    tokenUrl += '?' + queryParams.join('&');
  }

  try {
    const response = await fetch(tokenUrl, {
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.token || data.access_token || null;
  } catch (e) {
    return null;
  }
}

function parseWwwAuthenticate(header) {
  const params = {};
  const realmMatch = header.match(/realm="([^"]+)"/);
  if (realmMatch) params.realm = realmMatch[1];

  const serviceMatch = header.match(/service="([^"]+)"/);
  if (serviceMatch) params.service = serviceMatch[1];

  const scopeMatch = header.match(/scope="([^"]+)"/);
  if (scopeMatch) params.scope = scopeMatch[1];

  return params;
}

async function followRedirect(url, count) {
  if (count >= MAX_REDIRECTS) {
    return new Response('Too many redirects', { status: 502, headers: CORS_HEADERS });
  }

  const headers = new Headers();

  if (isAmazonS3(url)) {
    headers.set('x-amz-content-sha256', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const now = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    headers.set('x-amz-date', now);
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        return await followRedirect(location, count + 1);
      }
    }

    return cleanResponse(response);
  } catch (e) {
    return new Response('Redirect follow error: ' + e.message, { status: 502, headers: CORS_HEADERS });
  }
}

function isAmazonS3(url) {
  try {
    return new URL(url).hostname.includes('amazonaws.com');
  } catch (e) {
    return false;
  }
}
