import pytest

from tool.server import h3_prompt_contract


def test_mode_from_reference_roles():
    assert h3_prompt_contract.mode_from_reference_roles([]) == "T2VA"
    assert h3_prompt_contract.mode_from_reference_roles(["first_frame"]) == "I2VA"
    assert h3_prompt_contract.mode_from_reference_roles(["last_frame"]) == "L2VA"
    assert h3_prompt_contract.mode_from_reference_roles(["first_frame", "last_frame"]) == "FL2VA"


def test_t2va_has_no_alignment_text():
    assert h3_prompt_contract.alignment_line("T2VA", 10) == ""


def test_reference_alignment_is_the_only_model_prompt_syntax_webcap_owns():
    assert h3_prompt_contract.alignment_line("I2VA", 10) == (
        "For the target video, at 0.00 seconds into the target video, "
        "<Picture 1> (from [Shot 1]) is fully referenced."
    )
    assert "10.00-second mark" in h3_prompt_contract.alignment_line("L2VA", 10)
    assert "0.00-second mark" in h3_prompt_contract.alignment_line("FL2VA", 10)
    assert "10.00-second mark" in h3_prompt_contract.alignment_line("FL2VA", 10)


def test_alignment_rejects_invalid_mode_and_duration():
    with pytest.raises(ValueError, match="Unsupported"):
        h3_prompt_contract.alignment_line("REF2VA", 10)
    with pytest.raises(ValueError, match="numeric"):
        h3_prompt_contract.alignment_line("L2VA", "nope")


def test_apply_alignment_replaces_or_removes_legacy_app_owned_prefix():
    legacy = (
        "How the reference pictures align with the target video — <Picture 1> (from [Shot N]) "
        "aligns with the 6.00-second mark of the target video.\n\n"
        "A woman crosses a lobby."
    )

    replaced = h3_prompt_contract.apply_alignment(legacy, "I2VA", 8)
    assert replaced == (
        "For the target video, at 0.00 seconds into the target video, "
        "<Picture 1> (from [Shot 1]) is fully referenced.\n\n"
        "A woman crosses a lobby."
    )
    assert h3_prompt_contract.apply_alignment(legacy, "T2VA", 8) == "A woman crosses a lobby."
