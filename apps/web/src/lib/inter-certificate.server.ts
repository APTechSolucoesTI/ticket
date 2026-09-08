import { X509Certificate, createPrivateKey } from "node:crypto";

export function validateInterCertificate(
  certificatePem: string,
  privateKeyPem: string,
  now = Date.now(),
) {
  try {
    const certificate = new X509Certificate(certificatePem);
    if (!certificate.checkPrivateKey(createPrivateKey(privateKeyPem))) throw new Error("pair");
    const from = new Date(certificate.validFrom).getTime();
    const until = new Date(certificate.validTo).getTime();
    if (from > now || until <= now) throw new Error("date");
    return { expiresAt: new Date(until).toISOString(), fingerprint: certificate.fingerprint256 };
  } catch {
    throw new Error(
      "Certificado inválido, fora da validade ou incompatível com a chave. Envie o par PEM (.crt e .key) fornecido pelo Inter, sem senha.",
    );
  }
}
