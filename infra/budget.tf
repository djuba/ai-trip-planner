# Billing budget for the project (WU-21 plan D7). Google Cloud has no hard spend cap, so this is the
# early warning; the Anthropic workspace limit (WU-23) is the hard stop. Alerts go to the billing
# account's admins by email, so no address is stored here.

resource "google_billing_budget" "project" {
  billing_account = var.billing_account_id
  display_name    = "ai-trip-planner hosted environment"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.2
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.apis]
}
