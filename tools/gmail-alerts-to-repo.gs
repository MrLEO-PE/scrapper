/**
 * Files your job-alert emails into the repo, so the scheduled scrape can read
 * them. Runs inside YOUR Gmail (Google Apps Script) — nothing is installed on
 * a server, and the scraper never logs in to anything.
 *
 * SETUP (about ten minutes, once)
 *  1. In Gmail make a label called  job-alerts  and a filter that applies it to
 *     the alert senders (Search Associates, ISS, TIE Online, Schrole, TES,
 *     Teach Away, Eteach, LinkedIn, Indeed ...). Tick "Skip the inbox" if you
 *     like — this script does not need them in the inbox.
 *  2. Go to script.google.com -> New project -> paste this whole file.
 *  3. GitHub -> Settings -> Developer settings -> Fine-grained tokens ->
 *     Generate new token. Repository access: ONLY this repository.
 *     Permissions: Contents = Read and write. Nothing else. Copy the token.
 *  4. In the script: Project Settings -> Script properties -> add
 *       GITHUB_TOKEN = <the token>
 *       GITHUB_REPO  = MrLEO-PE/scrapper
 *  5. Run  setup()  once and approve the permissions. It creates a trigger
 *     that checks every 30 minutes.
 *
 * WHAT IS SENT. Only the sender, subject, date and the message body, with
 * tracking and unsubscribe links removed. Your own address, the To/Cc lines
 * and every other header are never sent. If the repository is public, so are
 * the files — keep it private if the alerts carry anything you would not
 * publish.
 *
 * Each message is filed once: afterwards the thread is relabelled
 * job-alerts-filed, so nothing is uploaded twice.
 */

var LABEL = "job-alerts";
var DONE_LABEL = "job-alerts-filed";
var BRANCH = "main";
var FOLDER = "data/inbox";
var MAX_PER_RUN = 20;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("fileAlerts").timeBased().everyMinutes(30).create();
  fileAlerts();
}

function fileAlerts() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GITHUB_TOKEN");
  var repo = props.getProperty("GITHUB_REPO");
  if (!token || !repo) throw new Error("Set GITHUB_TOKEN and GITHUB_REPO in Script properties.");

  var label = GmailApp.getUserLabelByName(LABEL);
  if (!label) throw new Error("Create the Gmail label '" + LABEL + "' first.");
  var done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);

  var threads = GmailApp.search("label:" + LABEL + " -label:" + DONE_LABEL, 0, MAX_PER_RUN);
  threads.forEach(function (thread) {
    var ok = true;
    thread.getMessages().forEach(function (msg) {
      try { upload_(repo, token, msg); } catch (e) { ok = false; console.error(e); }
    });
    // Only mark a thread filed when every message in it really got there, so a
    // failed upload is tried again on the next run rather than lost.
    if (ok) thread.addLabel(done);
  });
}

function sanitise_(html) {
  return html
    // Links that identify you or unsubscribe you are not vacancies.
    .replace(/<a\b[^>]*href=["'][^"']*(unsubscribe|preferences|optout|opt-out|manage)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<img\b[^>]*>/gi, "");
}

function upload_(repo, token, msg) {
  var date = msg.getDate();
  var html = sanitise_(msg.getBody() || "");
  var eml = [
    "From: " + msg.getFrom(),
    "Subject: " + msg.getSubject(),
    "Date: " + date.toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Utilities.base64Encode(html, Utilities.Charset.UTF_8),
  ].join("\r\n");

  var stamp = Utilities.formatDate(date, "UTC", "yyyyMMdd-HHmm");
  var name = stamp + "-" + msg.getId().slice(-8) + ".eml";
  var res = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/contents/" + FOLDER + "/" + name, {
    method: "put",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    payload: JSON.stringify({
      message: "Job alert " + stamp,
      branch: BRANCH,
      content: Utilities.base64Encode(eml, Utilities.Charset.UTF_8),
    }),
  });
  var code = res.getResponseCode();
  // 422 means the file already exists: it was filed on an earlier run.
  if (code !== 201 && code !== 200 && code !== 422) {
    throw new Error("GitHub said " + code + ": " + res.getContentText().slice(0, 200));
  }
}
