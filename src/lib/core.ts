import got from 'got';
import NodeCache from 'node-cache';
// import jose from 'node-jose';
import * as jose from 'jose'
import { GetKeyFunction } from 'jose/dist/types/types';

const cache = new NodeCache({ stdTTL: 3600 });

type WellKnownConfig = {
    issuer: string;
    token_endpoint: string;
    jwks_uri: string;
    userinfo_endpoint: string;
    response_types_supported: string[];
    id_token_signing_alg_values_supported: string[];
    grant_types_supported: string[];
    subject_types_supported: string[];
    scopes_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    claims_supported: string[];
    code_challenge_methods_supported: string[];
    introspection_endpoint_auth_methods_supported: string[];
    request_parameter_supported: boolean;
    request_object_signing_alg_values_supported: string[];
}

type ValidateTokenOpts = {
    config: TConfig;
}

export async function fetchRowndWellKnownConfig(apiUrl: string): Promise<WellKnownConfig> {
    if (cache.has('oauth-config')) {
        return cache.get('oauth-config') as WellKnownConfig;
    }

    let resp: WellKnownConfig = await got.get(`${apiUrl}/hub/auth/.well-known/oauth-authorization-server`).json();
    cache.set('oauth-config', resp);
    
    return resp;
}

async function fetchRowndJwks(jwksUrl: string): Promise<GetKeyFunction<jose.JWSHeaderParameters, jose.FlattenedJWSInput>> {
    if (cache.has('jwks')) {
        return jose.createLocalJWKSet(cache.get('jwks') as jose.JSONWebKeySet);
    }

    let resp: jose.JSONWebKeySet = await got.get(jwksUrl).json();
    cache.set('jwks', resp);

    return jose.createLocalJWKSet(resp);
}

export async function validateToken(token: string, { config }: ValidateTokenOpts): Promise<jose.JWTPayload | string | void> {
    let authConfig = await fetchRowndWellKnownConfig(config.api_url);

    let keystore = await fetchRowndJwks(authConfig.jwks_uri);

    let verifyResp = await jose.jwtVerify(token, keystore);
    return verifyResp.payload;
}

export async function fetchUserInfo(token: string, config: TConfig): Promise<any> {
    let decodedToken = jose.decodeJwt(token);

    if (!decodedToken.aud) {
        throw new Error('No audience found in token. Is this a valid token?');
    }

    let appAudience = (decodedToken.aud as string[]).find(a => a.startsWith('app:'));

    if (!appAudience) {
        throw new Error('No app audience found in token. Is this a valid token?');
    }

    if (cache.has(`user:${decodedToken.sub}`)) {
        return cache.get(`user:${decodedToken.sub}`) as any;
    }

    let app = appAudience.split(':')[1];

    let userId = decodedToken['https://auth.rownd.io/app_user_id'];

    let resp = await got.get(`${config.api_url}/applications/${app}/users/${userId}/data`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }).json();

    cache.set(`user:${decodedToken.sub}`, resp, 300);

    return resp;
}
