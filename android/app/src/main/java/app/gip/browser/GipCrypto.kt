package app.gip.browser

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Chiffrement de Gip pour Android.
 * - Clé de compte : PBKDF2-HMAC-SHA256 (210 000 itérations) → AES-256-GCM
 * - Gip Mail : ECDH P-256 éphémère + SHA-256 → AES-256-GCM (chiffrement de bout en bout)
 */
object GipCrypto {
    private val rng = SecureRandom()
    private val MAGIC = "GIP2".toByteArray()

    fun random(n: Int) = ByteArray(n).also { rng.nextBytes(it) }
    fun b64(b: ByteArray): String = java.util.Base64.getEncoder().encodeToString(b)
    fun unb64(s: String): ByteArray = java.util.Base64.getDecoder().decode(s)

    fun deriveKey(password: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, 210_000, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    }

    fun encrypt(key: ByteArray, data: ByteArray): ByteArray {
        val iv = random(12)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return MAGIC + iv + c.doFinal(data)
    }

    fun decrypt(key: ByteArray, blob: ByteArray): ByteArray {
        require(blob.size > 32 && blob.copyOfRange(0, 4).contentEquals(MAGIC)) { "Format inconnu" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob.copyOfRange(4, 16)))
        return c.doFinal(blob, 16, blob.size - 16)
    }

    fun sha256(vararg parts: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        parts.forEach { md.update(it) }
        return md.digest()
    }

    fun newKeyPair(): Pair<String, String> {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec("secp256r1"))
        val kp = g.generateKeyPair()
        return b64(kp.public.encoded) to b64(kp.private.encoded)
    }

    private fun pub(b64: String): PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(unb64(b64)))
    private fun priv(b64: String): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(unb64(b64)))

    private fun ecdh(privKey: PrivateKey, pubKey: PublicKey): ByteArray {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(privKey)
        ka.doPhase(pubKey, true)
        return sha256("gip-mail-v1".toByteArray(), ka.generateSecret())
    }

    /** Chiffre pour un destinataire. Retourne (clé publique éphémère, blob). */
    fun sealFor(recipientPub: String, data: ByteArray): Pair<String, String> {
        val (ephPub, ephPriv) = newKeyPair()
        val k = ecdh(priv(ephPriv), pub(recipientPub))
        return ephPub to b64(encrypt(k, data))
    }

    fun open(myPriv: String, ephPub: String, blob: String): ByteArray =
        decrypt(ecdh(priv(myPriv), pub(ephPub)), unb64(blob))

    fun sha1Hex(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02X".format(it) }

    fun randomInt(n: Int) = rng.nextInt(n)
}
