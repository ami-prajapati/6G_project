# Trained model artefacts

Copy the two files produced by the Google Colab notebook into this folder:

| file                      | produced by                         |
|---------------------------|-------------------------------------|
| `doppler_lstm_weights.pt` | `torch.save(model.state_dict(), ...)` |
| `doppler_norm_stats.npz`  | saved next to the weights (input/target standardisation) |

Both are required: the weights alone cannot be used without the normalisation statistics.
