#ifdef GL_ES
precision highp float;
#endif

#pragma glslify: toGamma   = require(glsl-gamma/out)
#pragma glslify: random    = require(glsl-random)
#pragma glslify: tonemapReinhard  = require(../local_modules/glsl-tonemap-reinhard)
#pragma glslify: sky  = require(../local_modules/glsl-sky)
#pragma glslify: envMapCube  = require(../local_modules/glsl-envmap-cube)

uniform mat4 uInverseViewMatrix;
uniform samplerCube uReflectionMap;
uniform sampler2D uHammersleyPointSetMap;
uniform float uExposure;
uniform float uRoughness;
uniform vec3 uSunPosition;

varying vec3 ecPosition;
varying vec3 ecNormal;

float PI = 3.1415926536;

//Port from HLSL to GLSL
float saturate(float f) {
    return f;
    //return clamp(f, 0.0, 1.0);
}

vec3 sampleSky(vec3 dir) {
    return sky(uSunPosition, dir);
}

vec3 sampleEvnMap(vec3 dir) {
    return textureCube(uReflectionMap, envMapCube(dir)).rgb;
}

//Sampled from a texture generated by code based on
//http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
vec2 Hammersley(int i, int N) {
    return texture2D(uHammersleyPointSetMap, vec2(0.5, (float(i) + 0.5)/float(N))).rg;
}

//Based on Real Shading in Unreal Engine 4
//Visibility Term: Schlick-Smith
//                                          n.v           //                           (0.8 + 0.5*a)^2
//G(l,v,h) = G1(l)* G1(v)    G1(v) = -----------------    //  where is that from?  k = ---------------
//                                   (n.v) * (1-k) + k    //                                  2
float G_Smith(float Roughness, float NoL, float NoV) {
    //Source?
    //float a = Roughness * Roughness;
    //float k = pow(0.8 + 0.5 * a, 2.0) / 2.0;

    //Source: UE4
    //float a = Roughness + 1;
    //float k = a * a / 8;

    //Source: ? - my implementation of ggx
    float a = Roughness * Roughness;
    float k = a / 2.0;

    //Source: UE4
    float G1l = NoL / (NoL * (1.0 - k) + k);
    float G1v = NoV / (NoV * (1.0 - k) + k);

    float Glvn = G1l * G1v;
    return Glvn;
}

//Based on PlayCanvas
//https://github.com/playcanvas/engine/blob/28100541996a74112b8d8cda4e0b653076e255a2/src/graphics/programlib/chunks/prefilterCubemap.ps
vec3 ImportanceSampleGGXPlayCanvas(vec2 Xi, float Roughness, vec3 N) {
    //this is mapping 2d point to a hemisphere but additionally we add spread by roughness
    //float a = Roughness * Roughness;
    //float Phi = 2.0 * PI * Xi.x;
    //float CosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
    //float SinTheta = sqrt(1.0 - CosTheta * CosTheta);
    float Phi = Xi.y * 2.0 * PI;
    //float specPow = (1.0-Roughness) * 1024.0;
    //float CosTheta = pow(1.0 - Xi.x, 1.0 / (specPow + 1.0));
    float CosTheta = sqrt(1.0 - Xi.x);
    float SinTheta = sqrt(1.0 - CosTheta * CosTheta);
    vec3 H;
    H.x = SinTheta * cos(Phi);
    H.y = SinTheta * sin(Phi);
    H.z = CosTheta;

    //Tangent space vectors
    vec3 UpVector = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 TangentX = normalize(cross(UpVector, N));
    vec3 TangentY = cross(N, TangentX);

    //Tangent to World Space
    //return TangentX * H.x + TangentY * H.y + N * H.z;
    //
    vec3 n = N;
    float a = 1.0 / (1.0 + n.z);
    float b = -n.x * n.y * a;
    vec3 b1 = vec3(1.0 - n.x * n.x * a, b, -n.x);
    vec3 b2 = vec3(b, 1.0 - n.y * n.y * a, -n.y);
    mat3 vecSpace = mat3(b1, b2, n);
    return normalize(mix(vecSpace * H, N, 1.0 - Roughness));
}

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

//Based on Real Shading in Unreal Engine 4
//TODO: N & L, which coordinate space they are in?
vec3 SpecularIBL(vec3 SpecularColor, float Roughness, vec3 N, vec3 V) {
    vec3 SpecularLighting = vec3(0.0);
    const int NumSamples = 512;
    for(int i=0; i<NumSamples; i++) {
        vec2 Xi = Hammersley(i, NumSamples);
        //vec3 H = ImportanceSampleGGXUE4(Xi, Roughness, N);
        vec3 H = ImportanceSampleGGXPlayCanvas(Xi, Roughness, N);
        vec3 L = 2.0 * dot(V, H) * H - V;

        float NoV = saturate(dot(N, V));
        float NoL = saturate(dot(N, L));
        float NoH = saturate(dot(N, H));
        float VoH = saturate(dot(V, H));

        if (NoL > 0.0) {
            vec3 SampleColor = sampleEvnMap(L);
            SampleColor = sampleSky(L);

            float G = G_Smith(Roughness, NoL, NoV);
            float Fc = pow(1.0 - VoH, 5.0);
            vec3 F = (1.0 - Fc) * SpecularColor + Fc;

            SpecularLighting += SampleColor * F * G * VoH / (NoH * NoV);
        }
    }
    return SpecularLighting / NumSamples;
}

void main() {
    vec3 ecEyeDir = normalize(-ecPosition);
    vec3 wcEyeDir = vec3(uInverseViewMatrix * vec4(ecEyeDir, 0.0));
    vec3 wcNormal = vec3(uInverseViewMatrix * vec4(ecNormal, 0.0));

    vec3 reflectionWorld = reflect(-wcEyeDir, normalize(wcNormal));
    gl_FragColor.rgb = SpecularIBL(vec3(0.99), uRoughness, wcNormal, wcEyeDir);
    gl_FragColor.rgb *= uExposure;
    gl_FragColor.rgb = tonemapReinhard(gl_FragColor.rgb);
    gl_FragColor.rgb = toGamma(gl_FragColor.rgb);
    gl_FragColor.a = 1.0;
}
