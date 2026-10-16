def test_dotenv_values_drop_inline_comments():
    from app.config import _dotenv_value

    assert _dotenv_value("replay                 # record | replay | off") == "replay"
    assert _dotenv_value("") == ""
    assert _dotenv_value('"a # not a comment"  # comment') == "a # not a comment"
    assert _dotenv_value("abc#def") == "abc#def"
