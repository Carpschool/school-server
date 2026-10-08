import {gcm} from '@noble/ciphers/aes.js';
export const encrypt=(key,iv,data)=>gcm(key,iv).encrypt(data);
