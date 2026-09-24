from tool.server import generation_director_contract


def test_generate_h3_director_uses_structured_content_and_deterministic_renderer():
    request = generation_director_contract.build_request(
        "minimax_h3",
        "write_prompt",
        prompt="A woman enters a rain-soaked lobby.",
        settings={"duration": 8},
        reference_roles=["first_frame", "last_frame"],
    )

    assert request["output"] == "json"
    assert request["response_schema"]["required"] == [
        "integrated_multimodal_description",
        "overall_soundscape",
        "non_diegetic_music",
    ]
    assert request["result_renderer"] == {
        "type": "h3_base",
        "mode": "FL2VA",
        "duration": 8,
    }
    assert "[H3 MODE]\nFL2VA" in request["prompt"]
    assert "8.00-second mark" in request["prompt"]
    assert "WebCap owns the final labels and alignment syntax" in request["prompt"]


def test_generate_h3_director_defaults_to_t2va_without_reference_roles():
    request = generation_director_contract.build_request(
        "minimax_h3",
        "refine_prompt",
        prompt="integrated_multimodal_description: [Shot 1] She waits.",
        instruction="Make the camera slowly push in.",
        settings={"duration": 6},
    )

    assert request["result_renderer"]["mode"] == "T2VA"
    assert "How the reference pictures align" not in request["prompt"]


def test_generate_non_h3_director_remains_plain_text():
    request = generation_director_contract.build_request(
        "krea2_raw",
        "write_prompt",
        prompt="A portrait in a quiet studio.",
    )

    assert request["output"] == "text"
    assert "response_schema" not in request
    assert "result_renderer" not in request
