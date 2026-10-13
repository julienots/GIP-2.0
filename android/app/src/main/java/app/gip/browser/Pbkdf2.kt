package app.gip.browser

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018) rapide, en Kotlin pur.
 * Les états HMAC (clé ⊕ ipad / clé ⊕ opad) sont précalculés une seule fois : chaque itération
 * ne coûte alors que deux compressions SHA-256, sans allocation ni appel JNI.
 * (Le "PBKDF2WithHmacSHA256" d'Android passe par BouncyCastle et prenait plusieurs minutes.)
 */
object Pbkdf2 {
    private val K = intArrayOf(
        0x428a2f98, 0x71374491, -0x4a3f0431, -0x164a245b, 0x3956c25b, 0x59f111f1, -0x6dc07d5c, -0x54e3a12b,
        -0x27f85568, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, -0x7f214e02, -0x6423f959, -0x3e640e8c,
        -0x1b64963f, -0x1041b87a, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        -0x67c1aeae, -0x57ce3993, -0x4ffcd838, -0x40a68039, -0x391ff40d, -0x2a586eb9, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, -0x7e3d36d2, -0x6d8dd37b,
        -0x5d40175f, -0x57e599b5, -0x3db47490, -0x3893ae5d, -0x2e6d17e7, -0x2966f9dc, -0xbf1ca7b, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, -0x7b3787ec, -0x7338fdf8, -0x6f410006, -0x5baf9315, -0x41065c09, -0x398e870e
    )
    private val H0 = intArrayOf(0x6a09e667, -0x4498517b, 0x3c6ef372, -0x5ab00ac6, 0x510e527f, -0x64fa9774, 0x1f83d9ab, 0x5be0cd19)

    /** Compresse un bloc de 16 mots dans `state`. */
    private fun compress(state: IntArray, block: IntArray, w: IntArray) {
        for (i in 0 until 16) w[i] = block[i]
        for (i in 16 until 64) {
            val x = w[i - 15]; val y = w[i - 2]
            val s0 = (x ushr 7 or (x shl 25)) xor (x ushr 18 or (x shl 14)) xor (x ushr 3)
            val s1 = (y ushr 17 or (y shl 15)) xor (y ushr 19 or (y shl 13)) xor (y ushr 10)
            w[i] = w[i - 16] + s0 + w[i - 7] + s1
        }
        var a = state[0]; var b = state[1]; var c = state[2]; var d = state[3]
        var e = state[4]; var f = state[5]; var g = state[6]; var h = state[7]
        for (i in 0 until 64) {
            val s1 = (e ushr 6 or (e shl 26)) xor (e ushr 11 or (e shl 21)) xor (e ushr 25 or (e shl 7))
            val ch = (e and f) xor (e.inv() and g)
            val t1 = h + s1 + ch + K[i] + w[i]
            val s0 = (a ushr 2 or (a shl 30)) xor (a ushr 13 or (a shl 19)) xor (a ushr 22 or (a shl 10))
            val maj = (a and b) xor (a and c) xor (b and c)
            val t2 = s0 + maj
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d
        state[4] += e; state[5] += f; state[6] += g; state[7] += h
    }

    private fun sha256(data: ByteArray): ByteArray {
        val md = java.security.MessageDigest.getInstance("SHA-256"); return md.digest(data)
    }

    /** État SHA-256 après absorption d'un bloc de 64 octets (clé ⊕ pad). */
    private fun padState(key: ByteArray, pad: Int): IntArray {
        val st = H0.copyOf(); val blk = IntArray(16); val w = IntArray(64)
        for (i in 0 until 16) {
            var v = 0
            for (j in 0 until 4) { val idx = i * 4 + j; val kb = if (idx < key.size) key[idx].toInt() and 0xff else 0; v = (v shl 8) or (kb xor pad) }
            blk[i] = v
        }
        compress(st, blk, w); return st
    }

    fun derive(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
        val key = if (password.size > 64) sha256(password) else password
        val inner = padState(key, 0x36)
        val outer = padState(key, 0x5c)
        val w = IntArray(64)

        // U1 = HMAC(P, salt || INT(1)) — calculé via l'API standard (une seule fois)
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(password, "HmacSHA256"))
        mac.update(salt); mac.update(byteArrayOf(0, 0, 0, 1))
        val u1 = mac.doFinal()

        // Blocs pré-remplis : 32 octets de message + padding SHA-256 pour une longueur de 64+32 octets
        val blk = IntArray(16)
        val u = IntArray(8)
        for (i in 0 until 8) u[i] = ((u1[i * 4].toInt() and 0xff) shl 24) or ((u1[i * 4 + 1].toInt() and 0xff) shl 16) or ((u1[i * 4 + 2].toInt() and 0xff) shl 8) or (u1[i * 4 + 3].toInt() and 0xff)
        val t = u.copyOf()
        val st = IntArray(8)
        for (n in 1 until iterations) {
            // inner = SHA256(ipadState, u)
            for (i in 0 until 8) { st[i] = inner[i]; blk[i] = u[i] }
            blk[8] = Int.MIN_VALUE; for (i in 9 until 15) blk[i] = 0; blk[15] = (64 + 32) * 8
            compress(st, blk, w)
            // outer = SHA256(opadState, inner)
            for (i in 0 until 8) blk[i] = st[i]
            for (i in 0 until 8) st[i] = outer[i]
            blk[8] = Int.MIN_VALUE; for (i in 9 until 15) blk[i] = 0; blk[15] = (64 + 32) * 8
            compress(st, blk, w)
            for (i in 0 until 8) { u[i] = st[i]; t[i] = t[i] xor st[i] }
        }
        val out = ByteArray(32)
        for (i in 0 until 8) { out[i * 4] = (t[i] ushr 24).toByte(); out[i * 4 + 1] = (t[i] ushr 16).toByte(); out[i * 4 + 2] = (t[i] ushr 8).toByte(); out[i * 4 + 3] = t[i].toByte() }
        return out
    }
}
