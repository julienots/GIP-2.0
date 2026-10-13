package app.gip.browser

import android.net.Uri
import android.text.Html
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Gip Search : requêtes relayées sans cookies ni identifiant (même logique que la version bureau). */
object GipSearch {
    private const val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"

    private fun clean(s: String) = Html.fromHtml(s, Html.FROM_HTML_MODE_LEGACY).toString().replace(Regex("\\s+"), " ").trim()

    fun query(qIn: String, page: Int): JSONObject {
        val q = qIn.trim()
        val out = JSONObject().put("query", q).put("page", page)
        if (q.isEmpty()) return out.put("results", JSONArray())
        val body = "q=" + URLEncoder.encode(q, "UTF-8") + "&kl=fr-fr&s=${page * 25}&dc=${page * 25 + 1}"
        val c = URL("https://html.duckduckgo.com/html/").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10000; c.readTimeout = 15000
        c.setRequestProperty("User-Agent", UA)
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.setRequestProperty("Sec-GPC", "1")
        c.outputStream.use { it.write(body.toByteArray()) }
        val html = c.inputStream.bufferedReader().readText()
        val results = JSONArray()
        val aRe = Regex("<a[^>]*class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>")
        val snRe = Regex("class=\"result__snippet\"[^>]*>([\\s\\S]*?)</(?:a|div)>")
        for (chunk in html.split("<div class=\"result results_links").drop(1)) {
            if (results.length() >= 30) break
            if (chunk.take(200).contains("result--ad")) continue
            val a = aRe.find(chunk) ?: continue
            var href = a.groupValues[1].replace("&amp;", "&")
            if (href.startsWith("//")) href = "https:$href"
            val u = Uri.parse(href)
            if (u.host?.endsWith("duckduckgo.com") == true) {
                if (u.path?.startsWith("/y.js") == true) continue
                u.getQueryParameter("uddg")?.let { href = it }
            }
            val host = Uri.parse(href).host?.removePrefix("www.") ?: ""
            results.put(JSONObject().put("url", href).put("title", clean(a.groupValues[2]))
                .put("snippet", snRe.find(chunk)?.let { clean(it.groupValues[1]) } ?: "").put("host", host))
        }
        return out.put("results", results)
    }

    fun suggest(qIn: String): List<String> {
        val q = qIn.trim()
        if (q.isEmpty() || q.length > 200) return emptyList()
        return try {
            val c = URL("https://duckduckgo.com/ac/?type=list&kl=fr-fr&q=" + URLEncoder.encode(q, "UTF-8")).openConnection() as HttpURLConnection
            c.setRequestProperty("User-Agent", UA); c.connectTimeout = 5000; c.readTimeout = 5000
            val j = JSONArray(c.inputStream.bufferedReader().readText())
            val l = j.optJSONArray(1) ?: return emptyList()
            (0 until minOf(6, l.length())).map { l.getString(it) }
        } catch (e: Exception) { emptyList() }
    }
}
