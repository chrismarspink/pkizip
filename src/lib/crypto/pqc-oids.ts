/**
 * PQC OID 상수 — ML-KEM (RFC 9935), ML-DSA (RFC 9881), CMS (RFC 9936)
 */

// ML-KEM (FIPS 203)
export const OID_ML_KEM_512  = '2.16.840.1.101.3.4.4.1';
export const OID_ML_KEM_768  = '2.16.840.1.101.3.4.4.2';
export const OID_ML_KEM_1024 = '2.16.840.1.101.3.4.4.3';

// ML-DSA (FIPS 204)
export const OID_ML_DSA_44   = '2.16.840.1.101.3.4.3.17';
export const OID_ML_DSA_65   = '2.16.840.1.101.3.4.3.18';
export const OID_ML_DSA_87   = '2.16.840.1.101.3.4.3.19';

// X.509 Extensions
export const OID_KEY_USAGE         = '2.5.29.15';
export const OID_BASIC_CONSTRAINTS = '2.5.29.19';
export const OID_SUBJECT_KEY_ID    = '2.5.29.14';

// X.520 AttributeType
export const OID_COMMON_NAME   = '2.5.4.3';
export const OID_EMAIL_ADDRESS = '1.2.840.113549.1.9.1';
export const OID_ORGANIZATION  = '2.5.4.10';

// CMS (RFC 5652)
export const OID_DATA           = '1.2.840.113549.1.7.1';
export const OID_SIGNED_DATA    = '1.2.840.113549.1.7.2';
export const OID_ENVELOPED_DATA = '1.2.840.113549.1.7.3';

// AES-256-GCM
export const OID_AES_256_GCM = '2.16.840.1.101.3.4.1.46';
