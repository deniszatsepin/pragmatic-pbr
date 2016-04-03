#pragma glslify: envMapEquirect  = require(../../local_modules/glsl-envmap-equirect)
#pragma glslify: envMapCube      = require(../../local_modules/glsl-envmap-cube)
#pragma glslify: toGamma  = require(glsl-gamma/out)
#pragma glslify: toLinear = require(glsl-gamma/in)
#pragma glslify: tonemapUncharted2  = require(../../local_modules/glsl-tonemap-uncharted2)
#pragma glslify: random    = require(glsl-random)

//Disney
//https://github.com/wdas/brdf/blob/master/src/brdfs/disney.brdf

#ifdef GL_ES
precision highp float;
#endif

#ifdef GL_ES
  #extension GL_EXT_shader_texture_lod : require
#else
  #extension GL_ARB_shader_texture_lod : require
#endif

uniform bool uUE4;
uniform bool uUE4Prefiltered;

uniform mat4 uInverseViewMatrix;
uniform float uExposure;
uniform float uIor;
uniform sampler2D uHammersleyPointSetMap;
uniform sampler2D uBrdfLut;

uniform vec3 uLightPos;
uniform vec4 uLightColor;

varying vec3 vPositionWorld;
varying vec3 vPositionView;
varying vec3 vNormalWorld;
varying vec3 vNormalView;
varying vec2 vTexCoord;

varying vec3 vLightPosView;

struct FragData {
  vec3 color;
  vec3 albedo;
  float opacity;
  float roughness;
  float metalness;
  vec3 specularity;
  vec3 positionWorld;
  vec3 positionView;
  vec3 normalWorld;
  vec3 normalView;
  vec2 texCoord;
  vec3 eyePosView;
  vec3 eyeDirWorld;
  vec3 eyeDirView;
  vec3 lightColor;
  float lightAtten;
  vec3 lightPosView;
  vec3 lightPosWorld;
  vec3 lightDirView;
  vec3 lightDirWorld;
  vec3 reflectionColor;
  vec3 irradianceColor;
  float exposure;
};

uniform vec4 uAlbedoColor; //assumes sRGB color, not linear

vec3 getAlbedo(inout FragData data) {
    return toLinear(uAlbedoColor.rgb);
}

float lambert(vec3 surfaceNormal, vec3 lightDir) {
    return max(0.0, dot(surfaceNormal, lightDir));
}

float getLightDiffuse(inout FragData data) {
    return lambert(data.normalView, data.lightDirView);
}

float phong(vec3 lightDir, vec3 eyeDir, vec3 normal) {
    vec3 R = reflect(-lightDir, normal);
    return dot(R, eyeDir);
}

//Based on Coding Labs and Graphics Rants
float chiGGX(float v) {
    return v > 0 ? 1 : 0;
}

float saturate(float f) {
    return clamp(f, 0.0, 1.0);
}

vec3 saturate(vec3 v) {
    return clamp(v, vec3(0.0), vec3(1.0));
}

//Sampled from a texture generated by code based on
//http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
vec2 Hammersley(int i, int N) {
    return texture2D(uHammersleyPointSetMap, vec2(0.5, (float(i) + 0.5)/float(N))).rg;
}

//Based on Coding Labs and Graphics Rants
float GGX_Distribution(vec3 n, vec3 h, float alpha) {
    float NoH = dot(n,h);
    float alpha2 = alpha * alpha;
    float NoH2 = NoH * NoH;
    float den = NoH2 * alpha2 + (1.0 - NoH2);
    //chiGGX removed to follow Graphics Rants, will get away with NdotL anyway
    return (chiGGX(NoH) * alpha2) / ( PI * den * den );
    //return (alpha2) / ( PI * den * den );
}

//TODO: doesn't seem to work / do anything
//Based on Coding Labs
float GGX_PartialGeometryTerm(vec3 v, vec3 n, vec3 h, float alpha)
{
    float VoH2 = saturate(dot(v,h));
    float chi = chiGGX( VoH2 / saturate(dot(v,n)) );
    VoH2 = VoH2 * VoH2;
    float tan2 = ( 1 - VoH2 ) / VoH2;
    //return chi / (1 + tan2);
    //return ( 1 + sqrt( 1 + alpha * alpha * tan2 ));
    return (chi * 2) / ( 1 + sqrt( 1 + alpha * alpha * tan2 ) );
}

vec3 Fresnel_Schlick(float cosT, vec3 F0)
{
  return F0 + (1-F0) * pow( 1 - cosT, 5);
}

float getLightSpecular(inout FragData data) {
    float ior = uIor;
    vec3 F0 = vec3(abs((1.0 - ior) / (1.0 + ior)));
    F0 = F0 * F0;
    F0 = mix(F0, data.albedo, data.metalness);

    float alpha = data.roughness * data.roughness;
    vec3 n = data.normalWorld;
    vec3 l = normalize(data.lightDirWorld);
    vec3 v = normalize(data.eyeDirWorld);
    vec3 h = normalize(v + l);
    float NdotL = saturate(dot(n, l));
    float HdotV = saturate(dot(h, v));
    float NoV = saturate(dot(n, v));
    float NoL = saturate(dot(n, l));
    float NoH = saturate(dot(n, h));
    float D = GGX_Distribution(n, h, alpha);
    float G = GGX_PartialGeometryTerm(v, n, h, alpha);
    float f = Fresnel_Schlick(dot(h, v), F0).r;
    //float denom = saturate( 4 * (NoV * NoL + 0.01) );
    float denom = saturate( 4 * (NoV * NoH + 0.01) );

    //float base = 1 - dot(v,h);
    //float exponential = pow( base, 5.0);
    //f = (exponential + F0.r * (1.0 - exponential));

    vec3 sampleVector = v;
    vec3 halfVector = normalize(sampleVector + v);
    float cosT = saturate(dot( sampleVector, n ));
    float sinT = sqrt( 1 - cosT * cosT);
    vec3 fresnel = Fresnel_Schlick( saturate(dot( h, v )), F0 );
    float geometry = GGX_PartialGeometryTerm(v, n, h, data.roughness) * GGX_PartialGeometryTerm(sampleVector, n, h, data.roughness);
    float denominator = saturate( 4 * (NoV * saturate(dot(h, n)) + 0.05) );
    //return 1 / denom;
    return f;
    return NdotL * D * f * G / denom;
    //return NdotL * geometry * fresnel.r * sinT / denominator;
}

uniform float uRoughness;

float getRoughness(inout FragData data) {
    return uRoughness;
}

uniform float uMetalness;

float getMetalness(inout FragData data) {
    return uMetalness;
}

//Schlick's approximation TODO: verify
vec3 getFresnel(inout FragData data) {
    float glossiness = 1.0 - data.roughness;
    float NdotV = max(0.0, dot(data.normalView, data.eyeDirView));
    float d = 1.0 - NdotV;
    float d2 = d * d;
    float fresnel = d2 * d2 * d * glossiness; //TODO: glossiness^2 like in Unreal Engine?
    return (1.0 - data.specularity) * fresnel;
}

#ifdef REFLECTION_MAP_CUBE
    uniform samplerCube uReflectionMap;

    vec3 getReflection(inout FragData data) {
        float maxMipMapLevel = 7.0; //TODO: const
        vec3 reflectionWorld = reflect(-data.eyeDirWorld, data.normalWorld);
        vec3 R = envMapCube(reflectionWorld);
        float k = 1.0 - (1.0 - data.roughness) * (1.0 - data.roughness);
        float lod = k * maxMipMapLevel;
        float upLod = floor(lod);
        float downLod = ceil(lod);
        //vec4 a = textureCubeLod(reflectionMap, fixSeams(reflectionWorld, upLod), upLod);
        //vec4 b = textureCubeLod(reflectionMap, fixSeams(reflectionWorld, downLod), downLod);
        vec3 a = textureCubeLod(uReflectionMap, R, upLod).rgb;
        vec3 b = textureCubeLod(uReflectionMap, R, downLod).rgb;
        return mix(a, b, lod - upLod);
        //return textureCubeLod(uReflectionMap, , data.roughness * 8.0).rgb;
    }
#else
    uniform sampler2D uReflectionMap;

    vec3 getReflection(inout FragData data) {
        vec3 reflectionWorld = reflect(-data.eyeDirWorld, data.normalWorld);
        return texture2D(uReflectionMap, envMapEquirect(reflectionWorld)).rgb;
    }
#endif

#ifdef IRRADIANCE_MAP_CUBE
    uniform samplerCube uIrradianceMap;

    vec3 getIrradiance(inout FragData data) {
        float maxMipMapLevel = 7.0; //TODO: const
        vec3 reflectionWorld = reflect(-data.eyeDirWorld, data.normalWorld);
        vec3 R = envMapCube(reflectionWorld);
        return textureCube(uIrradianceMap, R).rgb;
    }
#else
    uniform sampler2D uReflectionMap;

    vec3 getIrradiance(inout FragData data) {
        vec3 reflectionWorld = reflect(-data.eyeDirWorld, data.normalWorld);
        return texture2D(uIrradianceMap, envMapEquirect(reflectionWorld)).rgb;
    }
#endif

void mainCodingLabsOld() {
    FragData data;
    data.color = vec3(0.0);
    data.albedo = vec3(0.0);
    data.opacity = 1.0;
    data.positionWorld = vPositionWorld;
    data.positionView = vPositionView;
    data.normalWorld = normalize(vNormalWorld);
    data.normalView = normalize(vNormalView);
    data.texCoord = vTexCoord;
    data.eyePosView = vec3(0.0, 0.0, 0.0);
    data.eyeDirView = normalize(data.eyePosView - data.positionView);
    data.eyeDirWorld = vec3(uInverseViewMatrix * vec4(data.eyeDirView, 0.0));
    data.lightAtten = 1.0;
    data.lightColor = toLinear(uLightColor.rgb);
    data.lightPosWorld = uLightPos;
    data.lightPosView = vLightPosView;
    data.lightDirWorld = normalize(data.lightPosWorld - data.positionWorld);
    data.lightDirView = normalize(data.lightPosView - data.positionView);
    data.reflectionColor = vec3(0.0);
    data.exposure = uExposure;

    data.albedo = getAlbedo(data);
    data.lightAtten = getLightDiffuse(data);
    data.roughness = getRoughness(data);
    data.metalness = getMetalness(data);

    //TODO: figure out specularity color for diaelectricts with small metalness
    //Specularity aka F0
    data.specularity = toLinear(vec3(0.04)); //TODO: 0.04 = plastic, is this gamma or linear?
    if (data.metalness == 1.0) {
        data.specularity = data.albedo;
        data.albedo = vec3(0.0); //TODO: metals don't have albedo, what about irradiance?
    }

    //TODO: reflectance?

    vec3 fresnel = getFresnel(data);
    data.specularity += fresnel;


    vec3 lightDiffuse = data.lightAtten * data.albedo * uLightColor.rgb; //TODO: remove albedo from here?
    vec3 lightSpecular = getLightSpecular(data) * uLightColor.rgb;

    data.irradianceColor = getIrradiance(data);
    data.reflectionColor = getReflection(data);

    data.color = data.albedo * data.irradianceColor; //TODO: multiply by albedo?
    //? data.color += data.albedo * data.irradianceColor * (1.0 - data.specularity);\n'

    //TODO: verify that
    //mixing diffuse and specular according to specularity for energy conservation
    data.color += mix(lightDiffuse, lightSpecular, data.specularity);

    data.color += data.specularity * data.reflectionColor;//TODO: is specular reflection shadowed by NdotL?

    //TMP data.color = data.irradianceColor;
    data.color = vec3(getLightSpecular(data));
    //vec3 l = normalize(reflect(-data.eyeDirView, data.normalView));
    //vec3 h = normalize(data.eyeDirView + l);
    vec3 n = data.normalView;
    vec3 l = normalize(data.lightDirView);
    vec3 v = normalize(data.eyeDirView);
    vec3 h = normalize(v + l);
    float ior = uIor;
    vec3 F0 = vec3(abs((1.0 - ior) / (1.0 + ior)));
    F0 = F0 * F0;
    float VdotH = saturate(dot(v, h));
    float NdotL = saturate(dot(n, l));
    float NdotH = saturate(dot(n, h));
    float NdotV = saturate(dot(n, v));
    data.color = data.reflectionColor * NdotL * Fresnel_Schlick(VdotH, F0);
    float alpha = data.roughness * data.roughness;
    float D = GGX_Distribution(n, h, alpha);
    float G = GGX_PartialGeometryTerm(v, n, h, alpha);
    vec3 F = Fresnel_Schlick(VdotH, F0); //VdotH
    float denom = saturate( 4 * (NdotV * NdotH + 0.01) );
    //vec3 indirectSpecular = D * G * F / denom;;
    vec3 indirectSpecular = NdotL * D * G * F / denom;;
    data.color = indirectSpecular;
    //data.color = F;
    //data.color = vec3(VdotH);
    //
    vec3 rl = normalize(reflect(-data.eyeDirView, data.normalView));
    vec3 rh = normalize(v + rl);
    float VdotRH = saturate(dot(v, rh));
    float NdotRH = saturate(dot(v, rh));
    float NdotRL = saturate(dot(n, rl));
    float rD = GGX_Distribution(n, rh, alpha);
    float rG = GGX_PartialGeometryTerm(v, n, rh, alpha);
    //vec3 rF = Fresnel_Schlick(NdotV, F0);
    vec3 rF = Fresnel_Schlick(VdotRH, F0);
    float rdenom = ( 4 * (NdotV * NdotRH + 0.01) );
    //data.color = data.reflectionColor * rF;
    //data.color = NdotRL * rD * rG * rF / rdenom;
    //data.color = data.reflectionColor * getFresnel(data);
    //data.color *= data.reflectionColor;

    data.color *= uExposure;


    #ifdef SHOW_NORMALS
        data.color = data.normalWorld * 0.5 + 0.5;
    #endif

    #ifdef SHOW_TEX_COORDS
        data.color = vec3(data.texCoord, 0.0);
    #endif

    #ifdef SHOW_FRESNEL
        data.color = rF * data.reflectionColor;
    #endif

    #ifdef SHOW_IRRADIANCE
        data.color = data.irradianceColor;
    #endif

    #ifdef SHOW_INDIRECT_SPECULAR
        data.color = indirectSpecular;
    #endif

    #ifdef USE_TONEMAP
        data.color = tonemapUncharted2(data.color);
    #endif

    data.color = toGamma(data.color);

    gl_FragColor.rgb = data.color;
    gl_FragColor.a = data.opacity;
}

const int SamplesCount = 64;

mat3 GenerateFrame(vec3 N) {
    return mat3(1.0);
}

vec3 GenerateGGXsampleVector(int i, int SamplesCount, float roughness) {
    return vec3(0.0);
}

vec3 GGX_Specular(samplerCube SpecularEnvmap, vec3 normal, vec3 viewVector, float roughness, vec3 F0, out vec3 kS ) {
    vec3 reflectionVector = reflect(-viewVector, normal);
    mat3 worldFrame = GenerateFrame(reflectionVector);
    vec3 radiance = vec3(0.0);
    float  NoV = saturate(dot(normal, viewVector));

    for(int i = 0; i < SamplesCount; ++i) {
        // Generate a sample vector in some local space
        vec3 sampleVector = GenerateGGXsampleVector(i, SamplesCount, roughness);
        // Convert the vector in world space
        sampleVector = normalize( worldFrame * sampleVector);

        // Calculate the half vector
        vec3 halfVector = normalize(sampleVector + viewVector);
        float cosT = saturate( dot(sampleVector, normal ));
        float sinT = sqrt( 1 - cosT * cosT);

        // Calculate fresnel
        vec3 fresnel = Fresnel_Schlick(saturate(dot( halfVector, viewVector )), F0 );
        // Geometry term
        float geometry = GGX_PartialGeometryTerm(viewVector, normal, halfVector, roughness) * GGX_PartialGeometryTerm(sampleVector, normal, halfVector, roughness);
        // Calculate the Cook-Torrance denominator
        float denominator = saturate( 4 * (NoV * saturate(dot(halfVector, normal)) + 0.05) );
        kS += fresnel;
        // Accumulate the radiance
        radiance += 0.0;//radiance += SpecularEnvmap.SampleLevel( trilinearSampler, sampleVector, ( roughness * mipsCount ) ).rgb * geometry * fresnel * sinT / denominator;
    }

    // Scale back for the samples count
    kS = saturate( kS / SamplesCount );
    return radiance / SamplesCount;
}

void mainCodingLabs() {
    FragData data;
    data.color = vec3(0.0);
    data.albedo = vec3(0.0);
    data.opacity = 1.0;
    data.positionWorld = vPositionWorld;
    data.positionView = vPositionView;
    data.normalWorld = normalize(vNormalWorld);
    data.normalView = normalize(vNormalView);
    data.texCoord = vTexCoord;
    data.eyePosView = vec3(0.0, 0.0, 0.0);
    data.eyeDirView = normalize(data.eyePosView - data.positionView);
    data.eyeDirWorld = vec3(uInverseViewMatrix * vec4(data.eyeDirView, 0.0));
    data.lightAtten = 1.0;
    data.lightColor = toLinear(uLightColor.rgb);
    data.lightPosWorld = uLightPos;
    data.lightPosView = vLightPosView;
    data.lightDirWorld = normalize(data.lightPosWorld - data.positionWorld);
    data.lightDirView = normalize(data.lightPosView - data.positionView);
    data.reflectionColor = vec3(0.0);
    data.exposure = uExposure;

    data.albedo = getAlbedo(data);
    data.roughness = getRoughness(data);
    data.metalness = getMetalness(data);
    data.irradianceColor = getIrradiance(data);
    data.reflectionColor = getReflection(data);

    float ior = uIor;

    // Calculate the diffuse contribution
    vec3 diffuse = data.albedo * data.irradianceColor;

    // Calculate colour at normal incidence
    vec3 F0 = vec3(abs((1.0 - ior) / (1.0 + ior)));
    F0 = F0 * F0;
    F0 = mix(F0, data.albedo, data.metalness);

    // Calculate the specular contribution
    vec3 ks = vec3(0.0);
    vec3 specular = GGX_Specular(uReflectionMap, data.normalView, data.eyeDirView, data.roughness, F0, ks);

    //energy conservation kd + ks <= 1
    //also making sure that for metalness = 1, kd = 0
    vec3 kd = (1.0 - ks) * (1.0 - data.metalness);

    data.color = kd * diffuse + /*ks **/ specular;

    float numMipMaps = 8;
    float mipLevel = data.roughness * numMipMaps;
    data.color = textureCubeLod(uReflectionMap, envMapCube(data.normalWorld), mipLevel).rgb;

    data.color = specular;

    #ifdef SHOW_NORMALS
        data.color = data.normalWorld * 0.5 + 0.5;
    #endif

    #ifdef SHOW_TEX_COORDS
        data.color = vec3(data.texCoord, 0.0);
    #endif

    #ifdef SHOW_FRESNEL
        //data.color = rF * data.reflectionColor;
    #endif

    #ifdef SHOW_IRRADIANCE
        data.color = data.irradianceColor;
    #endif

    #ifdef SHOW_INDIRECT_SPECULAR
        data.color = indirectSpecular;
    #endif

    #ifdef USE_TONEMAP
        data.color = tonemapUncharted2(data.color);
    #endif

    data.color = toGamma(data.color);

    gl_FragColor.rgb = data.color;
    gl_FragColor.a = data.opacity;
}

/*
float3 ImportanceSampleGGXUE4( float2 Xi, float Roughness, float3 N ) {
    float a = Roughness * Roughness;
    float Phi = 2 * PI * Xi.x;
    float CosTheta = sqrt( (1 - Xi.y) / ( 1 + (a*a - 1) * Xi.y ) ); float SinTheta = sqrt( 1 - CosTheta * CosTheta );
    float3 H;
    H.x = SinTheta * cos( Phi );
    H.y = SinTheta * sin( Phi );
    H.z = CosTheta;

    float3 UpVector = abs(N.z) < 0.999 ? float3(0,0,1) : float3(1,0,0);
    float3 TangentX = normalize( cross( UpVector, N ) );
    float3 TangentY = cross( N, TangentX );
    // Tangent to world space
    return TangentX * H.x + TangentY * H.y + N * H.z;
}
*/

//Based on Real Shading in Unreal Engine 4
vec3 ImportanceSampleGGXUE4(vec2 Xi, float Roughness, vec3 N) {
    //this is mapping 2d point to a hemisphere but additionally we add spread by roughness
    float a = Roughness * Roughness;
    float Phi = 2.0 * PI * Xi.x + random(N.xz) * 0.1;
    float CosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
    float SinTheta = sqrt(1.0 - CosTheta * CosTheta);
    vec3 H;
    H.x = SinTheta * cos(Phi);
    H.y = SinTheta * sin(Phi);
    H.z = CosTheta;

    //Tangent space vectors
    vec3 UpVector = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 TangentX = normalize(cross(UpVector, N));
    vec3 TangentY = normalize(cross(N, TangentX));

    //Tangent to World Space
    return TangentX * H.x + TangentY * H.y + N * H.z;

    //
    //vec3 n = N;
    //float aa = 1.0 / (1.0 + n.z);
    //float b = -n.x * n.y * aa;
    //vec3 b1 = vec3(1.0 - n.x * n.x * aa, b, -n.x);
    //vec3 b2 = vec3(b, 1.0 - n.y * n.y * aa, -n.y);
    //mat3 vecSpace = mat3(b1, b2, n);
    //return normalize(mix(vecSpace * H, N, 1.0 - Roughness));
}

/*
float3 SpecularIBLUE4( float3 SpecularColor, float Roughness, float3 N, float3 V ) {
    float3 SpecularLighting = 0;
    const uint NumSamples = 1024;
    for( uint i = 0; i < NumSamples; i++ ) {
        float2 Xi = Hammersley( i, NumSamples );

        float3 H = ImportanceSampleGGX( Xi, Roughness, N ); float3 L = 2 * dot( V, H ) * H - V;
        float NoV = saturate( dot( N, V ) ); float NoL = saturate( dot( N, L ) ); float NoH = saturate( dot( N, H ) ); float VoH = saturate( dot( V, H ) );
        if( NoL > 0 ) {
            float3 SampleColor = EnvMap.SampleLevel( EnvMapSampler, L, 0 ).rgb;
            float G = G_Smith( Roughness, NoV, NoL ); float Fc = pow( 1 - VoH, 5 );
            float3 F = (1 - Fc) * SpecularColor + Fc;
            // Incident light = SampleColor * NoL
            // Microfacet specular = D*G*F / (4*NoL*NoV)
            // pdf = D * NoH / (4 * VoH)
            SpecularLighting += SampleColor * F * G * VoH / (NoH * NoV);
        }
    }
    return SpecularLighting / NumSamples;
}
*/

float G_Smith(float Roughness, float NoL, float NoV) {
    float k = (Roughness + 1.0) * (Roughness + 1.0) / 8.0;
    float G1l = NoL / (NoL * (1.0 - k) + k);
    float G1v = NoV / (NoV * (1.0 - k) + k);
    float Glvh = G1l * G1v;
    return Glvh;
}

//Frostbite
vec3 F_Schlick(vec3 F0, float fd90, float cosT)
{
  return F0 + fd90 * pow( 1 - cosT, 5);
}

//Frostbite
float Fr_DisneyDiffuse(float NdotV, float NdotL, float LdotH, float linearRoughness)
{
    float energyBias = mix(0, 0.5, linearRoughness);
    float energyFactor = mix(1.0, 1.0 / 1.51, linearRoughness);
    float fd90 = energyBias + 2.0 * LdotH*LdotH * linearRoughness;
    vec3 f0 = vec3(1.0f, 1.0f, 1.0f);
    float lightScatter = F_Schlick(f0, fd90, NdotL).r;
    float viewScatter = F_Schlick(f0, fd90, NdotV).r;
    return lightScatter * viewScatter * energyFactor;
}


//Based on Real Shading in Unreal Engine 4
//TODO: N & L, which coordinate space they are in?
vec3 SpecularIBLUE4(vec3 SpecularColor, float Roughness, vec3 N, vec3 V, out vec3 ks) {
    vec3 SpecularLighting = vec3(0.0);
    const int NumSamples = 256;//512;
    for(int i=0; i<NumSamples; i++) {
        vec2 Xi = Hammersley(i, NumSamples);
        //vec3 H = ImportanceSampleGGXUE4(Xi, Roughness, N);
        vec3 H = ImportanceSampleGGXUE4(Xi, Roughness, N);
        vec3 L = 2.0 * dot(V, H) * H - V;

        float NoV = saturate(dot(N, V));
        float NoL = saturate(dot(N, L));
        float NoH = saturate(dot(N, H));
        float VoH = saturate(dot(V, H));

        if (NoL > 0.0) {
            vec3 SampleColor = textureCube(uReflectionMap, envMapCube(L)).rgb;

            float G = G_Smith(Roughness, NoL, NoV);
            float Fc = pow(1.0 - VoH, 5.0);
            vec3 F = (1.0 - Fc) * SpecularColor + Fc;
            ks += F;
            SpecularLighting += SampleColor * F * G * VoH / (NoH * NoV);
        }
    }
    ks /= NumSamples;
    return SpecularLighting / NumSamples;
}

//Unreal Engine 4
void mainUE4() {
    FragData data;
    data.color = vec3(0.0);
    data.albedo = vec3(0.0);
    data.opacity = 1.0;
    data.positionWorld = vPositionWorld;
    data.positionView = vPositionView;
    data.normalWorld = normalize(vNormalWorld);
    data.normalView = normalize(vNormalView);
    data.texCoord = vTexCoord;
    data.eyePosView = vec3(0.0, 0.0, 0.0);
    data.eyeDirView = normalize(data.eyePosView - data.positionView);
    data.eyeDirWorld = vec3(uInverseViewMatrix * vec4(data.eyeDirView, 0.0));
    data.lightAtten = 1.0;
    data.lightColor = toLinear(uLightColor.rgb);
    data.lightPosWorld = uLightPos;
    data.lightPosView = vLightPosView;
    data.lightDirWorld = normalize(data.lightPosWorld - data.positionWorld);
    data.lightDirView = normalize(data.lightPosView - data.positionView);
    data.reflectionColor = vec3(0.0);
    data.exposure = uExposure;

    data.albedo = getAlbedo(data);
    data.roughness = getRoughness(data);
    data.metalness = getMetalness(data);
    data.irradianceColor = getIrradiance(data);
    data.reflectionColor = getReflection(data);

    float ior = uIor;

    //Cook-Torrance Microfacet Specular
    float roughness = data.roughness;
    vec3 v = data.eyeDirView;
    vec3 l = data.lightDirView;
    vec3 h = normalize(v + l);
    vec3 n = data.normalView;
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = saturate(dot(n,h));
    float LdotH = saturate(dot(l,h));
    float NdotL = saturate(dot(n,l));
    float NdotV = saturate(dot(n,v));
    float VdotH = saturate(dot(v,h));

    //Specular D - normal distribution function (NDF), GGX/Trowbridge-Reitz
    float Ddenim = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float Dh = a * a / (PI * Ddenim * Ddenim);

    //Specular G - specular geometric attenuation
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float G1l = NdotL / (NdotL * (1.0 - k) + k);
    float G1v = NdotV / (NdotV * (1.0 - k) + k);
    float Glvh = G1l * G1v;

    //Specular F
    //Calculate colour at normal incidence
    vec3 F0 = vec3(abs((1.0 - ior) / (1.0 + ior)));
    F0 = F0 * F0;
    F0 = vec3(0.04); //default for non-metals in UE4
    F0 = mix(F0, data.albedo, data.metalness);

    vec3 Fvh = F0 + (vec3(1.0) - F0) * pow(2.0, (-5.55473 * VdotH -6.98316)*VdotH);
    //vec3 Fvh = F0 + (vec3(1.0) - F0) * pow(2.0, (-5.55473 * VdotH -6.98316)*VdotH);

    vec3 specular = Dh * Fvh * Glvh / (4.0 * NdotL * NdotV);

    data.color = vec3(specular);

    vec3 ks = vec3(0.0);
    n = data.normalWorld;
    v = data.eyeDirWorld;
    vec3 indirectSpecular = SpecularIBLUE4(F0, roughness, n, v, ks);
    vec3 kd = vec3((1.0 - ks) * (1.0 - data.metalness));
    data.color = kd * data.albedo * data.irradianceColor + ks * indirectSpecular;
    //data.color = ks * indirectSpecular;
    //data.color = indirectSpecular;

    //direct specular
    n = data.normalView;
    l = normalize(data.lightDirView);
    v = normalize(data.eyeDirView);
    h = normalize(v + l);

    float alpha = data.roughness * data.roughness;
    float D = GGX_Distribution(n, h, alpha);
    float G = GGX_PartialGeometryTerm(v, n, h, alpha);
    vec3 F = Fresnel_Schlick(VdotH, F0); //VdotH
    float Fd = Fr_DisneyDiffuse(NdotV, NdotL, LdotH, data.roughness);
    float denom = saturate( 4 * (NdotV * NdotH + 0.01) );
    //vec3 indirectSpecular = D * G * F / denom;;
    vec3 directSpecular = uLightColor.rgb * NdotL * D * G * F / denom;;
    vec3 directDiffuse = NdotL * uLightColor.rgb * data.albedo / PI;
    data.color += directDiffuse * Fd + directSpecular;

    //data.color = directSpecular;
    //data.color = directDiffuse;
    //data.color = F;

    //ks = Fvh;
    //kd = vec3((1.0 - ks) * (1.0 - data.metalness));
    //data.color = kd * NdotL * data.albedo + ks * vec3(specular);
    //data.color = specular;//Dh * Fvh * Glvh / (4.0 * NdotL * NdotV);

    #ifdef SHOW_NORMALS
        data.color = data.normalWorld * 0.5 + 0.5;
    #endif

    #ifdef SHOW_TEX_COORDS
        data.color = vec3(data.texCoord, 0.0);
    #endif

    #ifdef SHOW_FRESNEL
        //data.color = rF * data.reflectionColor;
    #endif

    #ifdef SHOW_IRRADIANCE
        data.color = data.irradianceColor;
    #endif

    #ifdef SHOW_INDIRECT_SPECULAR
        data.color = indirectSpecular;
    #endif

    #ifdef USE_TONEMAP
        data.color = tonemapUncharted2(data.color);
    #endif

    data.color = toGamma(data.color);

    gl_FragColor.rgb = data.color;
    gl_FragColor.a = data.opacity;

}

vec3 EnvBRDFApprox( vec3 SpecularColor, float Roughness, float NoV ) {
    const vec4 c0 = vec4(-1, -0.0275, -0.572, 0.022 );
    const vec4 c1 = vec4( 1, 0.0425, 1.04, -0.04 );
    vec4 r = Roughness * c0 + c1;
    float a004 = min( r.x * r.x, exp2( -9.28 * NoV ) ) * r.x + r.y;
    vec2 AB = vec2( -1.04, 1.04 ) * a004 + r.zw;
    return SpecularColor * AB.x + AB.y;
}

vec3 getPrefilteredReflection(inout FragData data) {
    float maxMipMapLevel = 5; //TODO: const
    vec3 reflectionWorld = reflect(-data.eyeDirWorld, data.normalWorld);
    //vec3 R = envMapCube(data.normalWorld);
    vec3 R = envMapCube(reflectionWorld);
    float lod = data.roughness * maxMipMapLevel;
    float upLod = floor(lod);
    float downLod = ceil(lod);
    //vec4 a = textureCubeLod(reflectionMap, fixSeams(reflectionWorld, upLod), upLod);
    //vec4 b = textureCubeLod(reflectionMap, fixSeams(reflectionWorld, downLod), downLod);
    vec3 a = textureCubeLod(uReflectionMap, R, upLod).rgb;
    vec3 b = textureCubeLod(uReflectionMap, R, downLod).rgb;
    return mix(a, b, lod - upLod);
}

//Unreal Engine 4
void mainUE4Prefiltered() {
    FragData data;
    data.color = vec3(0.0);
    data.albedo = vec3(0.0);
    data.opacity = 1.0;
    data.positionWorld = vPositionWorld;
    data.positionView = vPositionView;
    data.normalWorld = normalize(vNormalWorld);
    data.normalView = normalize(vNormalView);
    data.texCoord = vTexCoord;
    data.eyePosView = vec3(0.0, 0.0, 0.0);
    data.eyeDirView = normalize(data.eyePosView - data.positionView);
    data.eyeDirWorld = vec3(uInverseViewMatrix * vec4(data.eyeDirView, 0.0));
    data.lightAtten = 1.0;
    data.lightColor = toLinear(uLightColor.rgb);
    data.lightPosWorld = uLightPos;
    data.lightPosView = vLightPosView;
    data.lightDirWorld = normalize(data.lightPosWorld - data.positionWorld);
    data.lightDirView = normalize(data.lightPosView - data.positionView);
    data.reflectionColor = vec3(0.0);
    data.exposure = uExposure;

    data.albedo = getAlbedo(data);
    data.roughness = getRoughness(data);
    data.metalness = getMetalness(data);
    data.irradianceColor = getIrradiance(data);
    data.reflectionColor = getPrefilteredReflection(data);

    vec3 F0 = vec3(0.04); //default for non-metals in UE4
    F0 = mix(F0, data.albedo, data.metalness);

    vec3 n = data.normalView;
    vec3 v = normalize(data.eyeDirView);
    float NoV = saturate( dot( n, v ) );
    vec3 EnvBRDF = EnvBRDFApprox( F0, data.roughness, NoV );
    vec3 ks = vec3(0.0);
    vec3 kd = vec3((1.0 - ks) * (1.0 - data.metalness));
    data.color = kd * data.albedo * data.irradianceColor + data.reflectionColor * EnvBRDF;


    #ifdef USE_TONEMAP
        data.color = tonemapUncharted2(data.color);
    #endif

    data.color = toGamma(data.color);

    gl_FragColor.rgb = data.color;
    gl_FragColor.a = data.opacity;

}

void main() {
    if (uUE4) {
        mainUE4();
    }
    else if (uUE4Prefiltered) {
        mainUE4Prefiltered();
    }
    else {
        //mainCodingLabs();
        mainCodingLabsOld();
    }
}
