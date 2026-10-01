// German. A key with nothing here falls back to English, which keeps an
// oversight from breaking the page rather than making one acceptable: the test
// suite requires this file to have every key en.mjs has.

export default {
  'common.loading': 'Wird geladen…',
  'common.never': 'nie',

  'status.up': 'Betriebsbereit',
  'status.degraded': 'Beeinträchtigt',
  'status.partial': 'Teilausfall',
  'status.down': 'Ausgefallen',
  'status.none': 'Keine Daten',

  'banner.up': 'Alle Systeme betriebsbereit',
  'banner.degraded': 'Eingeschränkte Leistung',
  'banner.partial': 'Teilausfall',
  'banner.down': 'Schwerer Ausfall',
  'banner.none': 'Warten auf die erste Prüfung',
  'banner.stale': 'Status möglicherweise veraltet',
  'banner.staleMeta': 'Die letzte Prüfung war {when}',
  'banner.loading': 'Status wird geladen…',
  // The verb follows the number, which is why English keeps both forms even
  // though they read the same.
  'banner.notResponding': {
    one: '{monitors} antwortet nicht',
    other: '{monitors} antworten nicht',
  },

  'count.monitors': { one: '{count} Monitor', other: '{count} Monitore' },
  'group.allOperational': 'alle betriebsbereit',
  'group.down': '{count} ausgefallen',
  'group.degraded': '{count} beeinträchtigt',

  'strip.today': 'Heute',
  'strip.noData': 'Keine Daten',
  'strip.uptime': '{percent}% verfügbar',
  'strip.checks': { one: '{count} Prüfung', other: '{count} Prüfungen' },
  'strip.avg': 'Ø {ms}ms',

  'chart.empty': 'Noch nicht genug Antwortzeiten.',
  'chart.failed': 'Antwortzeiten konnten nicht geladen werden.',
  'chart.range': '{days}d Antwortzeit',
  'chart.legend': 'min {min}ms · Ø {avg}ms · max {max}ms',

  'figure.today': 'Heute',
  'figure.days': { one: '{count} Tag', other: '{count} Tage' },
  'figure.lastCheck': 'Letzte Prüfung',

  'detail.since': 'seit {date}',
  'detail.history': '{days} Tage Verlauf',
  'detail.certExpires': {
    one: 'Zertifikat läuft in {count} Tag ab, am {date}',
    other: 'Zertifikat läuft in {count} Tagen ab, am {date}',
  },
  'detail.certExpired': 'Zertifikat ist am {date} abgelaufen',
  'detail.responseTime': 'Antwortzeit',
  'detail.noIncidents': 'Keine Vorfälle für diesen Monitor.',

  'incidents.title': 'Vorfälle',
  'incidents.active': 'Aktiv',
  'incidents.upcoming': 'Geplant',
  'incidents.earlier': 'Früher',
  'incidents.empty': {
    one: 'Keine Vorfälle am letzten Tag.',
    other: 'Keine Vorfälle in den letzten {count} Tagen.',
  },
  'incidents.all': 'Alle Vorfälle auf GitHub',

  'incidents.feed': 'Atom-Feed',

  'feed.ongoing': 'Andauernd',
  'feed.resolvedAfter': 'Behoben nach {duration}',
  'feed.completedAfter': 'Abgeschlossen nach {duration}',

  'incident.downFor': 'Ausgefallen seit {duration}',
  'incident.startsIn': 'Beginnt {when}',
  'incident.maintenanceOpened': 'Wartung, eröffnet {when}',
  'incident.resolved': 'Behoben {when} nach {duration}',
  'incident.completed': 'Abgeschlossen {when} nach {duration}',
  'incident.state.open': 'offen',
  'incident.state.maintenance': 'Wartung',
  'incident.state.resolved': 'behoben',
  'incident.opened': 'eröffnet {date}',
  'incident.started': 'begonnen {date}',
  'incident.completedOn': 'abgeschlossen {date} nach {duration}',
  'incident.resolvedOn': 'behoben {date} nach {duration}',
  'incident.noBody': 'Keine Beschreibung angegeben.',
  'incident.issueLink': 'Issue #{number} auf GitHub',

  'comments.count': { one: '{count} Kommentar', other: '{count} Kommentare' },
  'comments.bot': 'Bot',
  'comments.more': {
    one: '{count} älterer Kommentar auf GitHub',
    other: '{count} ältere Kommentare auf GitHub',
  },

  'footer.checked': 'Geprüft {when}',
  'footer.source': 'Quelle',

  'error.title': 'Statusdaten nicht verfügbar',
  'empty.monitors': 'Keine Monitore konfiguriert. Lege eine Repository-Variable namens {name} an.',

  'field.url': 'URL',
  'field.error': 'Fehler',
  'field.code': 'Antwortcode',
  'field.issue': 'Issue',
  'field.firstFailure': 'Erster Fehlschlag',
  'field.unknown': 'unbekannt',
  'field.none': 'keiner',

  'field.expires': 'Läuft ab',
  'field.issuer': 'Aussteller',
  'notify.cert': {
    one: 'Das Zertifikat von {name} läuft in {count} Tag ab',
    other: 'Das Zertifikat von {name} läuft in {count} Tagen ab',
  },
  'issue.title': '{name} ist ausgefallen',
  'issue.intro': '**{name}** antwortet nicht mehr wie erwartet.',
  'issue.autoClose': 'Dieses Issue wird automatisch geschlossen, sobald der Monitor wieder antwortet.',
  'issue.recovered': 'Wieder erreichbar nach {duration} — {code} in {ms}ms.',

  'issue.updateTitle': 'Ein Update ändert Workflows und wartet, bis Sync von Hand läuft',
  'issue.updateIntro': 'Das Projekt, dem diese Seite folgt, hat ein Update, das seine Workflows ändert: {commit}.',
  'issue.updateWhy':
    'GitHub kann einen geänderten Workflow zur Freigabe zurückhalten, bevor er wieder läuft, und ein zurückgehaltener Uptime-Workflow prüft nichts, bis ihn jemand freigibt. Deshalb lässt der nächtliche Sync dieses Update samt Code für einen Lauf liegen, der von Hand gestartet wird.',
  'issue.updateSteps':
    '[Sync]({url}) im Actions-Tab ausführen. Danach den Actions-Tab noch einmal ansehen und jeden Lauf freigeben, den GitHub zurückhält.',
  'issue.updateAutoClose': 'Dieses Issue wird automatisch geschlossen, sobald das Update übernommen ist.',
  'issue.updateApplied': 'Übernommen: Die Seite läuft jetzt mit {commit}.',

  'notify.down': '{name} ist ausgefallen',
  'notify.degraded': '{name} ist beeinträchtigt',
  'notify.up': '{name} ist wieder erreichbar',
  'notify.upAfter': '{name} ist wieder erreichbar nach {duration}',
  'notify.update': '{name}: Ein Update ändert Workflows und wird erst übernommen, wenn Sync von Hand läuft',
  'field.update': 'Update',

  'a11y.toggleTheme': 'Design umschalten',
  'a11y.close': 'Schließen',
  'meta.description': 'Dienststatus und Verfügbarkeitsverlauf',
};
