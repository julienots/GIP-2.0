package app.gip.browser

import android.content.Context
import android.net.Uri

/** Bouclier Gip : utilise la même liste que la version bureau (src/main/blocklist.js). */
object Shield {
    private val ads = HashSet<String>()
    private val trackers = HashSet<String>()
    var params: List<String> = emptyList(); private set
    val httpExceptions = HashSet<String>()
    var adCount = 0; private set
    var trackerCount = 0; private set

    fun load(ctx: Context) {
        val js = ctx.assets.open("gip/blocklist.js").bufferedReader().readText()
        fun list(name: String): List<String> {
            val m = Regex("const $name = \\[([\\s\\S]*?)\\];").find(js) ?: return emptyList()
            return Regex("'([^']+)'").findAll(m.groupValues[1]).map { it.groupValues[1] }.toList()
        }
        list("ADS").forEach { ads.add(it.substringBefore('/')) }
        list("TRACKERS").forEach { trackers.add(it.substringBefore('/')) }
        params = list("TRACKING_PARAMS")
        adCount = ads.size; trackerCount = trackers.size
    }

    private fun match(set: Set<String>, host: String): Boolean {
        var h = host
        while (h.isNotEmpty()) {
            if (set.contains(h)) return true
            val i = h.indexOf('.'); if (i < 0) break
            h = h.substring(i + 1)
        }
        return false
    }

    /** "ad", "tracker" ou null */
    fun classify(hostIn: String?): String? {
        val host = hostIn?.lowercase() ?: return null
        return when { match(ads, host) -> "ad"; match(trackers, host) -> "tracker"; else -> null }
    }

    private val twoPart = setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.jp", "co.nz", "com.br", "com.mx", "co.in", "com.tr", "com.cn", "gouv.fr", "co.za", "com.ar")
    fun siteOf(host: String?): String {
        val parts = (host ?: "").lowercase().split('.').filter { it.isNotEmpty() }
        if (parts.size <= 2) return parts.joinToString(".")
        val last2 = parts.takeLast(2).joinToString(".")
        return if (last2 in twoPart) parts.takeLast(3).joinToString(".") else last2
    }

    fun isLocal(h: String) = h == "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(h) || h.startsWith("[")

    /** Retire les paramètres de pistage ; null si rien à changer. */
    fun cleanUrl(url: String): String? {
        val u = try { Uri.parse(url) } catch (e: Exception) { return null }
        if (u.query.isNullOrEmpty()) return null
        val names = u.queryParameterNames
        if (names.none { it in params }) return null
        val b = u.buildUpon().clearQuery()
        for (n in names) if (n !in params) for (v in u.getQueryParameters(n)) b.appendQueryParameter(n, v)
        return b.build().toString()
    }
}
