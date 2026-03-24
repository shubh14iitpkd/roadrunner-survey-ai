"""
Usage:
mailer = EmailSender(SMTP_SERVER, SMTP_PORT, AUTH_USER, AUTH_PASSWORD)
mailer.send_email(SENDER_EMAIL, SENDER_NAME, recipient, "Subject", plain, html)
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

class MailService:
    def __init__(self, smtp_server, smtp_port, auth_user, auth_password):
        self.smtp_server = os.getenv("SMTP_SERVER", smtp_server)
        self.smtp_port = int(os.getenv("SMTP_PORT", smtp_port))
        self.auth_user = os.getenv("AUTH_USER", auth_user)
        self.auth_password = os.getenv("AUTH_PASSWORD", auth_password)
        self.sender_email = os.getenv("SENDER_EMAIL", "noreply@roadvision.ai")
        self.sender_name = os.getenv("SENDER_NAME", "RoadSight AI")

    def send_email(self, recipient_email, subject, plain_body, html_body=None):
        # Use "alternative" so clients pick the best version (HTML preferred)
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{self.sender_name} <{self.sender_email}>"
        msg["To"] = recipient_email
        msg["Subject"] = subject
        msg["Reply-To"] = self.sender_email  # Important for spam filters

        # Always attach plain text FIRST, HTML second
        msg.attach(MIMEText(plain_body, "plain"))
        if html_body:
            msg.attach(MIMEText(html_body, "html"))

        try:
            print(f"Connecting to {self.smtp_server}:{self.smtp_port}...")
            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.ehlo()
            server.starttls()
            server.ehlo()

            print("Authenticating...")
            server.login(self.auth_user, self.auth_password)

            print(f"Sending to {recipient_email}...")
            server.send_message(msg)
            server.quit()
            print("Email sent successfully!")
            return True

        except smtplib.SMTPAuthenticationError:
            print("Auth failed - check App Password and that 2FA is enabled.")
        except Exception as e:
            print(f"Error: {e}")

        return False


    
