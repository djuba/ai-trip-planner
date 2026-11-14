# Inputs. Values that identify the environment (project, billing account) go in terraform.tfvars,
# which is git-ignored (see terraform.tfvars.example). Everything else has a working default.

variable "project_id" {
  description = "The Google Cloud project that holds the hosted environment."
  type        = string
}

variable "billing_account_id" {
  description = "The billing account the project is linked to, for the budget alert (e.g. 0X0X0X-0X0X0X-0X0X0X)."
  type        = string
}

variable "region" {
  description = "Region for the registry and the service. us-central1 is a Cloud Run free-tier region."
  type        = string
  default     = "us-central1"
}

variable "github_repository" {
  description = "owner/name of the GitHub repository whose deploy workflow may deploy."
  type        = string
  default     = "djuba/ai-trip-planner"
}

variable "github_repository_id" {
  description = "Numeric ID of that repository (gh api repos/<owner>/<name> --jq .id). Matching on the ID means a renamed or re-created repository with the same name can't deploy."
  type        = string
  default     = "1434919116"
}

variable "extra_deploy_ref" {
  description = "One extra git ref (e.g. refs/heads/scratch/wu-21-deploy) whose deploy.yml may also deploy. Only for proving a workflow change before merge; leave empty otherwise (WU-21 plan D10)."
  type        = string
  default     = ""

  validation {
    condition     = var.extra_deploy_ref == "" || can(regex("^refs/heads/[A-Za-z0-9._/-]+$", var.extra_deploy_ref))
    error_message = "extra_deploy_ref must be empty or one exact refs/heads/<branch> ref."
  }
}

variable "web_origin" {
  description = "The origin CORS allows (WEB_ORIGIN). No web service exists before WU-23, so it defaults to the local dev origin."
  type        = string
  default     = "http://localhost:3000"
}

variable "request_timeout_seconds" {
  description = "Cloud Run request timeout. Revisit once WU-10 measures the worst-case /recommend latency."
  type        = number
  default     = 300
}

variable "placeholder_image" {
  description = "Image the service is created with, before the deploy workflow has pushed one. Ignored after creation."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "budget_amount_usd" {
  description = "Monthly budget for the project, in US dollars. Alerts at 20%, 50% and 100% of actual spend, and 100% of forecast."
  type        = number
  default     = 5
}

# Invite codes (WU-22; ADR 0005 §5 and its WU-22 addendum). Each entry is `label:hash`, from
# `pnpm invite:new <label>`: the service never holds a code, only its SHA-256. Labels name the
# holders, so the values are kept out of plan output. Set them in terraform.tfvars (git-ignored).
variable "invite_codes" {
  description = "Active invite code entries (label:hash). Must include the CI code that the post-deploy contract check sends (infra/README.md)."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = alltrue([for entry in var.invite_codes : can(regex("^[a-z0-9-]{1,32}:[0-9a-f]{64}$", entry))])
    error_message = "Each entry must be label:hash (label [a-z0-9-]{1,32}, hash 64 lowercase hex); make one with pnpm invite:new <label>."
  }

  # The hashes of local-dev-invite and the tests' code (backends/api-nextjs/src/http/access-config.ts):
  # anyone with the repository knows them. The server refuses them on Cloud Run too; this catches
  # the mistake at plan time (WU-22 deviation 7).
  validation {
    condition = alltrue([for entry in var.invite_codes : !contains([
      "ef0876a0698d41ecf40c3fab1c80b26e141b656ebb0162d1f53df242b96f3f26",
      "9f6182f7f4e46cf3b6783072e59f271824b518a9310252430adac0c40863641f",
    ], element(split(":", entry), 1))])
    error_message = "An entry uses a code committed to the repository (the .env.example dev code or the tests' code)."
  }
}

variable "revoked_invite_codes" {
  description = "Revoked invite code entries (label:hash). Still refused, but logged as revoked, so attempts after revocation are visible."
  type        = list(string)
  sensitive   = true
  default     = []
}
