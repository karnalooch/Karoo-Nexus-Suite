/**
 * Generates an AWS CloudFront Signed URL for Hammerhead OTA Updates.
 * Bypasses 403 Forbidden S3 restrictions by emulating the native device's
 * CDNSigner.kt logic.
 */

export async function generateCloudFrontUrl(key: string): Promise<string> {
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCdfARMY9OEi/c/joONEZSDcFmFjfl1RuXXtxJoOM7gy3n/bZg6gWTuzHBJnb0pmtWTxxXeiPptikA+zrAKS35x/STAv2gNw+SFdBgFzL1IpXWJF0EsVyJGJbXZP8buFnDPqqYB79+cccc8G4JLa6JKVDyNZ6JKL/dIc2VEJxPUQ4pI527TqVRQ1XaDIXPFaqIvgqgaPC3n6sU+L5uxbNVyi934swt4bOfM9vmXF+KKMcH8z9EfMBBQySPKSXHTPFhGhylFf76ySkGPa0Jm1MbgQRAN1u1YrIvoYX07P9HrHyUx7ygbcPA2Iz2lPByjt1YWGly1aMvccq8Cuzjqc+17AgMBAAECggEAcPxn7RJ1z5PHqM6rbQte3Mo/QAVzIwPhpNlQmHuhWUBC39IWNGtfKcB9EyPbcj0G3EYqV4U4/lwA6c7KGCi/qDJxKuRoV+/iRSjcj1SrvLIQ2HFZreE50s/9XsdWBr0M5MDO53bcnFY5FdO6sDehsOgspVrj4Yv2QwGfdrz+iftl+Tav4OYcVR3FvEmrwyAJFctvZ4hVWQyKzrfyBRKYlV77azKkO1ELDQJHQQQPbf0AXhY6VXYBS41SMaYze9wIkJlJJqJV7Zb2OXwnf62HvV7fM3djWq9DeaBG1Suf0N81SjgqLPeM81BI5uBxQAYHORF6Nvz0PY3Q3uEfWv+7WQKBgQDZSRdXNdQEgN0vLdzJm6ls/FTNdZvtaQzkjmbN0oykXuJHfZQbJPUOdhS59b5NxPfKI0axKTRWCLa/f3hI+affcOCrHqxFhq5qykbrRBrMNtHH66KfTnReLNH52TQToUUobSx8z2qhEt99kUSUkNNIUtz1JdkbieQ0sdZzLy1KRwKBgQC5i0GtWddPBYy12O7V7CqadxCqGWBKEg/xDqLg43ZSvEz3HcXRsIENxq/fpUupi/la5cb+vVSQLkhnVgDodi+TX6OptuNCdp1ABztjMkVLIjm1i+4Qn9V6WYrtJcK8lOT34IO6MVTLKUTOLbv/39ibnEkLJwHv6akSiFSnAGOpLQKBgQCmb65JRxoYOP0z3lV4uJuWt9Hdb3D48bbGe62TiuvgHC4HxNFl2XE8moZVyz7yIyYK1+qWWZGVNSeGmAVzIIjORpBRgzVCLF/9vOOF4q0EMBmQoZX3oQjR+lL8pruVLbrjtHyXPenXZ7V5YYS+qBCvHYnS3iLnTUBYfMBfiouOkQKBgD+Fqo2TtX/rUXosc9AvU4KggscJewrA1k5cCW1e0nKO3va3bbNVb0ltHWc+6wF3133ELvWlkh7uiYE/U35CgBU/aAPBhlqJy1pRX4adflWzuPgrmOx+HBMQNtzr0ZjIjP9EETUckIAhd9nylGuMklbsEaHMz//4Chc7L2ghXP1dAoGAYnjF6fYPVKQEOx45JRnqbw7NxMqJzkV6RElhxlDl9649fatYhbfm5ua/CG4casG0YGkzOkVWCZJv6vtG29SJ9mucxNofcXGC8i0UmNYlLKMVusDHt0gqJ+T0bSTvL+UrPo3JnHt5u6wzuDOhANIlS4znMNbDAmOt6Tc8X0ntVTU=
-----END PRIVATE KEY-----`;

  const keyPairId = "APKAI6G2WKEFUEUUQLVA";
  const baseUrl = "https://prod-rom.api-hammerhead.io";
  const resourceUrl = `${baseUrl}/${key}`;
  
  // Calculate expiration (48 hours from now)
  const expires = Math.floor(Date.now() / 1000) + (48 * 3600);
  
  // Create Policy Statement
  const statement = JSON.stringify({
    Statement: [
      {
        Resource: resourceUrl,
        Condition: {
          DateLessThan: {
            "AWS:EpochTime": expires
          }
        }
      }
    ]
  });

  // Convert PEM to ArrayBuffer for Web Crypto API
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKeyPem.substring(
    privateKeyPem.indexOf(pemHeader) + pemHeader.length,
    privateKeyPem.indexOf(pemFooter)
  ).replace(/\\s/g, '');
  
  const binaryDerString = window.atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  // Import Key and Sign
  const cryptoKey = await window.crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-1" },
    },
    false,
    ["sign"]
  );

  const signatureBuffer = await window.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(statement)
  );

  // Convert Signature to Base64 and replace unsafe characters
  const signatureBase64 = window.btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  const safeSignature = signatureBase64
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');

  const connector = resourceUrl.includes('?') ? '&' : '?';
  return `${resourceUrl}${connector}Expires=${expires}&Signature=${safeSignature}&Key-Pair-Id=${keyPairId}`;
}
