package app.gip.browser

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Client MCP (Model Context Protocol) minimal pour Android.
 *
 * Transports pris en charge (un téléphone ne peut pas lancer de programmes locaux « stdio ») :
 *  - Streamable HTTP (spécification actuelle) : POST JSON-RPC, réponse JSON ou flux SSE,
 *    en-tête Mcp-Session-Id conservé entre les requêtes ;
 *  - SSE (ancienne spécification) : GET d'un flux d'événements qui annonce l'adresse
 *    « endpoint » où envoyer les requêtes, les réponses arrivant sur le flux.
 */
class McpClient(private val url: String, private val headers: Map<String, String>, private val legacySse: Boolean) {

    class McpException(msg: String) : Exception(msg)

    private val seq = AtomicInteger(1)
    @Volatile private var sessionId: String? = null
    @Volatile private var protocol = PROTOCOL
    @Volatile var serverName: String = ""; private set

    // Ancien transport SSE
    @Volatile private var postUrl: String? = null
    @Volatile private var sseConn: HttpURLConnection? = null
    @Volatile private var closed = false
    private val waiting = ConcurrentHashMap<Int, LinkedBlockingQueue<JSONObject>>()

    companion object {
        const val PROTOCOL = "2025-06-18"
        private const val TIMEOUT_MS = 180_000L
    }

    /* ------------------------------ Cycle de vie ------------------------------ */

    fun connect() {
        if (legacySse) openSse()
        val r = request("initialize", JSONObject()
            .put("protocolVersion", PROTOCOL)
            .put("capabilities", JSONObject())
            .put("clientInfo", JSONObject().put("name", "gip-browser-android").put("version", "2.0.0")))
        r.optString("protocolVersion").takeIf { it.isNotEmpty() }?.let { protocol = it }
        serverName = r.optJSONObject("serverInfo")?.optString("name") ?: ""
        notify("notifications/initialized")
    }

    fun listTools(): JSONArray {
        val all = JSONArray()
        var cursor: String? = null
        do {
            val p = JSONObject(); if (cursor != null) p.put("cursor", cursor)
            val r = request("tools/list", p)
            val t = r.optJSONArray("tools") ?: JSONArray()
            for (i in 0 until t.length()) all.put(t.get(i))
            cursor = r.optString("nextCursor").ifEmpty { null }
        } while (cursor != null && all.length() < 500)
        return all
    }

    fun callTool(name: String, args: JSONObject): JSONObject =
        request("tools/call", JSONObject().put("name", name).put("arguments", args))

    fun close() {
        closed = true
        try { sseConn?.disconnect() } catch (_: Exception) {}
        val sid = sessionId
        if (!legacySse && sid != null) {
            try { (URL(url).openConnection() as HttpURLConnection).apply { requestMethod = "DELETE"; setRequestProperty("Mcp-Session-Id", sid); connectTimeout = 3000; readTimeout = 3000; responseCode; disconnect() } } catch (_: Exception) {}
        }
        for (q in waiting.values) q.offer(JSONObject().put("error", JSONObject().put("message", "Connexion fermée")))
    }

    /* ------------------------------ JSON-RPC ------------------------------ */

    private fun notify(method: String) {
        val msg = JSONObject().put("jsonrpc", "2.0").put("method", method)
        if (legacySse) post(postUrl ?: throw McpException("Point d'envoi SSE inconnu"), msg, expectReply = false)
        else post(url, msg, expectReply = false)
    }

    private fun request(method: String, params: JSONObject): JSONObject {
        val id = seq.getAndIncrement()
        val msg = JSONObject().put("jsonrpc", "2.0").put("id", id).put("method", method).put("params", params)
        val reply: JSONObject = if (legacySse) {
            val q = LinkedBlockingQueue<JSONObject>()
            waiting[id] = q
            try {
                post(postUrl ?: throw McpException("Point d'envoi SSE inconnu"), msg, expectReply = false)
                q.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS) ?: throw McpException("Délai dépassé ($method)")
            } finally { waiting.remove(id) }
        } else post(url, msg, expectReply = true) ?: throw McpException("Réponse vide ($method)")
        reply.optJSONObject("error")?.let { throw McpException(it.optString("message", "Erreur MCP")) }
        return reply.optJSONObject("result") ?: JSONObject()
    }

    /** Envoie un message. En Streamable HTTP, renvoie la réponse JSON-RPC portant le même id. */
    private fun post(target: String, msg: JSONObject, expectReply: Boolean): JSONObject? {
        val c = URL(target).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.doOutput = true
        c.connectTimeout = 20_000
        c.readTimeout = TIMEOUT_MS.toInt()
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("Accept", "application/json, text/event-stream")
        if (!legacySse) {
            c.setRequestProperty("MCP-Protocol-Version", protocol)
            sessionId?.let { c.setRequestProperty("Mcp-Session-Id", it) }
        }
        for ((k, v) in headers) c.setRequestProperty(k, v)
        c.outputStream.use { it.write(msg.toString().toByteArray()) }
        val code = c.responseCode
        c.getHeaderField("Mcp-Session-Id")?.let { sessionId = it }
        if (code == 401 || code == 403) throw McpException("Accès refusé par le serveur MCP (HTTP $code) : vérifiez le jeton")
        if (code == 404 && sessionId != null) throw McpException("Session MCP expirée, reconnectez le serveur")
        if (code >= 400) {
            val err = try { c.errorStream?.bufferedReader()?.readText()?.take(300) } catch (_: Exception) { null }
            throw McpException("HTTP $code" + (if (!err.isNullOrBlank()) " : $err" else ""))
        }
        if (!expectReply || code == 202 || code == 204) { try { c.inputStream.close() } catch (_: Exception) {}; return null }
        val type = c.contentType ?: ""
        val id = msg.opt("id")
        return if (type.startsWith("text/event-stream")) {
            BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { r ->
                var found: JSONObject? = null
                readSse(r) { _, data ->
                    val o = try { JSONObject(data) } catch (_: Exception) { null }
                    if (o != null && o.has("id") && o.opt("id").toString() == id.toString() && (o.has("result") || o.has("error"))) { found = o; false } else true
                }
                found
            }
        } else {
            val body = c.inputStream.bufferedReader().readText()
            if (body.isBlank()) null
            else if (body.trimStart().startsWith("[")) JSONArray(body).let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.opt("id").toString() == id.toString() } }
            else JSONObject(body)
        }
    }

    /** Lit un flux SSE ; onEvent renvoie false pour arrêter la lecture. */
    private fun readSse(r: BufferedReader, onEvent: (String, String) -> Boolean) {
        var event = "message"
        val data = StringBuilder()
        while (true) {
            val line = r.readLine() ?: break
            when {
                line.isEmpty() -> {
                    if (data.isNotEmpty()) { if (!onEvent(event, data.toString().trimEnd('\n'))) return }
                    event = "message"; data.setLength(0)
                }
                line.startsWith(":") -> {}
                line.startsWith("event:") -> event = line.substring(6).trim()
                line.startsWith("data:") -> data.append(line.substring(5).removePrefix(" ")).append('\n')
            }
        }
    }

    private fun openSse() {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("Accept", "text/event-stream")
        for ((k, v) in headers) c.setRequestProperty(k, v)
        c.connectTimeout = 20_000
        c.readTimeout = 0
        val code = c.responseCode
        if (code >= 400) throw McpException("HTTP $code à l'ouverture du flux SSE")
        sseConn = c
        val ready = LinkedBlockingQueue<String>()
        Thread({
            try {
                BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { r ->
                    readSse(r) { ev, data ->
                        if (ev == "endpoint") ready.offer(URL(URL(url), data.trim()).toString())
                        else try {
                            val o = JSONObject(data)
                            val id = o.optInt("id", -1)
                            if (id >= 0) waiting[id]?.offer(o)
                        } catch (_: Exception) {}
                        !closed
                    }
                }
            } catch (_: Exception) {}
            for (q in waiting.values) q.offer(JSONObject().put("error", JSONObject().put("message", "Flux SSE fermé")))
        }, "gip-mcp-sse").apply { isDaemon = true }.start()
        postUrl = ready.poll(20, TimeUnit.SECONDS) ?: throw McpException("Le serveur SSE n'a pas annoncé de point d'envoi")
    }
}
