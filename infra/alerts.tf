# Email when the access gate refuses a known holder (WU-23a plan D6): a revoked or expired code, a
# spent quota, or a full window. The per-code hourly window is the threshold for "unusual volume",
# so rate_limited covers it. Unknown and missing codes are left out: scanners would make them noise.

resource "google_monitoring_notification_channel" "email" {
  display_name = "ai-trip-planner alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "gate_refusals" {
  display_name = "Access gate: revoked, expired, exhausted or rate-limited"
  combiner     = "OR"

  conditions {
    display_name = "A gate refusal for a known holder"
    condition_matched_log {
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"${local.service_name}\"",
        "jsonPayload.event=\"gate\"",
        "jsonPayload.outcome=(\"revoked\" OR \"expired\" OR \"quota_exhausted\" OR \"rate_limited\")",
      ])
      # The holder's label and the outcome appear in the email.
      label_extractors = {
        code    = "EXTRACT(jsonPayload.code)"
        outcome = "EXTRACT(jsonPayload.outcome)"
      }
    }
  }

  alert_strategy {
    # At most one email per 5 minutes, however many refusals.
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    mime_type = "text/markdown"
    content   = "The access gate refused a known holder. In Logs Explorer: `jsonPayload.event=\"gate\"`, filtered on `jsonPayload.code` (the label). See infra/README.md, \"Invite codes\"."
  }
}
