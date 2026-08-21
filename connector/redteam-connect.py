#!/usr/bin/env python3
"""Relays red-team prompts to a model that only your own machine can reach.

Makes outbound HTTPS requests only: it asks the gateway for work, calls your
model, and posts the reply back. Nothing listens on a port and nothing inbound
is required, so it works behind NAT and corporate firewalls.

    python redteam-connect.py --gateway https://app.example.com \
        --token ct_... --url http://localhost:7070/generate

Standard library only -- no install step, and short enough to read before you
run it inside your network.
"""

import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request

# Kept under the 30s idle timeout that proxies and load balancers commonly apply
# to an open connection.
POLL_WAIT_SECONDS = 25
NETWORK_TIMEOUT_SECONDS = POLL_WAIT_SECONDS + 10

RETRY_START_SECONDS = 1
RETRY_MAX_SECONDS = 30


def post_json(url, payload, timeout, token=None, context=None):
    body = json.dumps(payload).encode()
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", "Bearer " + token)
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        raw = response.read()
        return response.status, (json.loads(raw) if raw else None)


def get_json(url, timeout, token, context=None):
    request = urllib.request.Request(url, method="GET")
    request.add_header("authorization", "Bearer " + token)
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        if response.status == 204:
            return None
        return json.loads(response.read())


def call_model(args, prompt, context):
    """Sends one prompt to the local model and returns its reply."""
    try:
        _, body = post_json(
            args.url,
            {args.prompt_field: prompt},
            timeout=args.model_timeout,
            token=args.model_key,
            context=context,
        )
    except urllib.error.HTTPError as err:
        # urlopen raises before the body is read, and that body is usually the
        # only thing that says why the model refused.
        detail = err.read()[:500].decode("utf-8", "replace").strip()
        raise RuntimeError(
            "model endpoint returned HTTP %s%s" % (err.code, ": " + detail if detail else "")
        )
    if isinstance(body, str):
        return body
    if isinstance(body, dict):
        for field in (args.response_field, "output", "generated_text", "response", "text"):
            if isinstance(body.get(field), str):
                return body[field]
        raise RuntimeError(
            "model reply has no '%s' field; got keys %s"
            % (args.response_field, sorted(body))
        )
    raise RuntimeError("model returned %s, expected an object or string" % type(body).__name__)


def run(args):
    poll_url = "%s/connect/poll?wait=%d" % (args.gateway.rstrip("/"), POLL_WAIT_SECONDS)
    result_url = "%s/connect/result" % args.gateway.rstrip("/")
    # Only for the model call: a local endpoint is commonly self-signed, while
    # the gateway is a public host and stays verified.
    model_context = ssl._create_unverified_context() if args.insecure else None

    print("connector running; polling %s" % args.gateway, flush=True)
    backoff = RETRY_START_SECONDS

    while True:
        try:
            job = get_json(poll_url, NETWORK_TIMEOUT_SECONDS, args.token)
            backoff = RETRY_START_SECONDS
        except urllib.error.HTTPError as err:
            if err.code in (401, 403):
                print("token rejected by the gateway -- issue a new one", file=sys.stderr)
                return 1
            print("poll failed: HTTP %s; retrying in %ss" % (err.code, backoff), file=sys.stderr)
            time.sleep(backoff)
            backoff = min(backoff * 2, RETRY_MAX_SECONDS)
            continue
        except Exception as err:
            print("poll failed: %s; retrying in %ss" % (err, backoff), file=sys.stderr)
            time.sleep(backoff)
            backoff = min(backoff * 2, RETRY_MAX_SECONDS)
            continue

        if not job:
            continue

        try:
            reply = {"job_id": job["job_id"], "output": call_model(args, job["prompt"], model_context)}
        except Exception as err:
            # Reported rather than swallowed: the run shows why the target failed
            # instead of waiting out the gateway's timeout.
            print("model call failed: %s" % err, file=sys.stderr)
            reply = {"job_id": job["job_id"], "error": str(err)}

        try:
            post_json(result_url, reply, NETWORK_TIMEOUT_SECONDS, args.token)
        except Exception as err:
            print("could not deliver reply: %s" % err, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gateway", required=True, help="base URL shown with your token")
    parser.add_argument("--token", required=True, help="connector token (ct_...)")
    parser.add_argument("--url", required=True, help="your model endpoint, e.g. http://localhost:7070/generate")
    parser.add_argument("--prompt-field", default="input_text", dest="prompt_field")
    parser.add_argument("--response-field", default="output", dest="response_field")
    parser.add_argument("--model-key", default=None, dest="model_key", help="bearer token for your own endpoint")
    parser.add_argument("--model-timeout", type=float, default=300, dest="model_timeout")
    parser.add_argument("--insecure", action="store_true", help="skip TLS checks on your endpoint only")
    args = parser.parse_args()

    try:
        return run(args)
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
        return 0


if __name__ == "__main__":
    sys.exit(main())
