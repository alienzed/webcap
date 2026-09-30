from tool.server import generation_director_contract


def test_generate_h3_director_returns_authored_text_and_defers_alignment_to_generation_boundary():
    request = generation_director_contract.build_request(
        "minimax_h3",
        "write_prompt",
        prompt="A woman enters a rain-soaked lobby.",
        settings={"duration": 8},
        reference_roles=["first_frame", "last_frame"],
    )

    assert request["output"] == "text"
    assert "response_schema" not in request
    assert "result_renderer" not in request
    assert "[REFERENCE MODE]\nFL2VA" in request["prompt"]
    assert "Attached exact reference roles: first_frame, last_frame." in request["prompt"]
    assert "WebCap will prepend the required mechanical" in request["prompt"]
    assert "8.00-second mark" not in request["prompt"]


def test_generate_h3_director_defaults_to_t2va_without_reference_roles():
    request = generation_director_contract.build_request(
        "minimax_h3",
        "refine_prompt",
        prompt="A woman waits in a quiet room.",
        instruction="Make the camera slowly push in.",
        settings={"duration": 6},
    )

    assert request["output"] == "text"
    assert "[REFERENCE MODE]\nT2VA" in request["prompt"]
    assert "[REFERENCE HANDLING]" not in request["prompt"]


def test_generate_non_h3_director_remains_plain_text():
    request = generation_director_contract.build_request(
        "krea2_raw",
        "write_prompt",
        prompt="A portrait in a quiet studio.",
    )

    assert request["output"] == "text"
    assert "response_schema" not in request
    assert "result_renderer" not in request
