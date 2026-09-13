// German. Keys missing here fall back to English, so a partial translation is
// a usable one.

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
  'detail.responseTime': 'Antwortzeit',
  'detail.noIncidents': 'Keine Vorfälle für diesen Monitor.',

  'incidents.title': 'Vorfälle',
  'incidents.active': 'Aktiv',
  'incidents.earlier': 'Früher',
  'incidents.empty': {
    one: 'Keine Vorfälle am letzten Tag.',
    other: 'Keine Vorfälle in den letzten {count} Tagen.',
  },
  'incidents.all': 'Alle Vorfälle auf GitHub',

  'incident.downFor': 'Ausgefallen seit {duration}',
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

  'a11y.toggleTheme': 'Design umschalten',
  'a11y.close': 'Schließen',
  'meta.description': 'Dienststatus und Verfügbarkeitsverlauf',
};
