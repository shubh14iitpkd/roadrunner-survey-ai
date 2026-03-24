"""
Email template helpers for RoadSight AI transactional emails.

Each function returns a (subject, plain_text, html) tuple.
Usage:
    subject, plain, html = signup_request_email("Jane", "jane@example.com")
    mailer.send_email(recipient_email, subject, plain, html)
"""

import os
from flask import render_template

_LOGIN_URL = os.getenv("APP_BASE_URL", "https://roadsightai.roadvision.ai")


def get_mailer():
    """Return a MailService instance configured from environment variables."""
    from services.MailService import MailService
    return MailService(
        smtp_server=os.getenv("SMTP_SERVER", ""),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        auth_user=os.getenv("AUTH_USER", ""),
        auth_password=os.getenv("AUTH_PASSWORD", ""),
    )

_ROLE_ORDER = {"viewer": 0, "surveyor": 1, "admin": 2, "super_admin": 3}


def signup_request_email(first_name: str, email: str) -> tuple:
    """Sent to a new user after they sign up, while their account is pending approval."""
    display_name = first_name or email
    subject = "Your RoadSight AI account request has been received"
    plain = (
        f"Hi {display_name},\n\n"
        "Thank you for registering with RoadSight AI.\n\n"
        "Your account request has been received and is currently pending review by an administrator. "
        "You will receive another email as soon as your account is approved and ready to use.\n\n"
        f"Email:  {email}\n"
        "Status: Pending approval\n\n"
        "If you did not create this account, please ignore this email.\n\n"
        "-- RoadSight AI Team"
    )
    html = render_template(
        "emails/signup_request.html",
        display_name=display_name,
        email=email,
    )
    return subject, plain, html


def account_approved_email(first_name: str, email: str, role: str) -> tuple:
    """Sent to a user when an admin approves their account."""
    display_name = first_name or email
    subject = "Your RoadSight AI account has been approved"
    plain = (
        f"Hi {display_name},\n\n"
        "Great news — your RoadSight AI account has been approved!\n\n"
        "You can now log in and start using the platform.\n\n"
        f"Email: {email}\n"
        f"Role:  {role}\n\n"
        f"Log in at: {_LOGIN_URL}\n\n"
        "-- RoadSight AI Team"
    )
    html = render_template(
        "emails/account_approved.html",
        display_name=display_name,
        email=email,
        role=role,
        login_url=_LOGIN_URL,
    )
    return subject, plain, html


def account_revoked_email(first_name: str, email: str) -> tuple:
    """Sent to a user when an admin revokes (deletes) their account."""
    display_name = first_name or email
    subject = "Your RoadSight AI account has been revoked"
    plain = (
        f"Hi {display_name},\n\n"
        f"Your RoadSight AI account ({email}) has been revoked by an administrator.\n\n"
        "You will no longer be able to log in to the platform. "
        "If you believe this was done in error, please contact your organization's administrator.\n\n"
        "-- RoadSight AI Team"
    )
    html = render_template(
        "emails/account_revoked.html",
        display_name=display_name,
        email=email,
    )
    return subject, plain, html


def role_changed_email(first_name: str, email: str, old_role: str, new_role: str) -> tuple:
    """Sent to a user when an admin changes their role."""
    display_name = first_name or email

    old_rank = _ROLE_ORDER.get(old_role.lower().replace(" ", "_"), 0)
    new_rank = _ROLE_ORDER.get(new_role.lower().replace(" ", "_"), 0)
    promoted = new_rank >= old_rank
    action = "promoted" if promoted else "updated"
    heading_color = "#1e40af" if promoted else "#92400e"
    badge_bg = "#dbeafe" if promoted else "#fef3c7"
    badge_fg = "#1e40af" if promoted else "#92400e"

    subject = f"Your RoadSight AI role has been updated to {new_role}"
    plain = (
        f"Hi {display_name},\n\n"
        "Your role on RoadSight AI has been updated by an administrator.\n\n"
        f"Previous role: {old_role}\n"
        f"New role:      {new_role}\n\n"
        "Your new permissions will take effect the next time you log in.\n\n"
        f"Log in at: {_LOGIN_URL}\n\n"
        "-- RoadSight AI Team"
    )
    html = render_template(
        "emails/role_changed.html",
        display_name=display_name,
        email=email,
        old_role=old_role,
        new_role=new_role,
        action=action,
        heading_color=heading_color,
        badge_bg=badge_bg,
        badge_fg=badge_fg,
        login_url=_LOGIN_URL,
    )
    return subject, plain, html
